// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address owner) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IShares {
    function mint(address asset, string calldata symbol, uint256 qty) external returns (address);
    function burn(address asset, uint256 qty) external;
}

/// @title One agent's trading desk
/// @notice Holds the USDG of one of the Council's AI agents and keeps its trades on record.
///         Each agent has a desk of its own, so what an agent did can be read at one address.
///
///         A trade here is not a swap on a market. The desk buys and sells at the live price
///         its operator reports, and the treasury takes the other side: when a position is
///         closed at a gain the treasury pays the gain in, and at a loss the desk pays the
///         loss out. So the USDG held here always equals the agent's cash plus what its open
///         positions cost.
///
///         For every position the desk holds a receipt, issued by the Council's share book.
///         A receipt is a record of the position. It is not the token it names, it can't be
///         exchanged for it, and it can't be moved.
///
///         The operator is trusted to report true prices. This contract has not been audited
///         and is meant for a testnet.
contract AgentDesk {
    /// @dev Prices are USD with 18 decimals, fine enough for a token worth a millionth of a cent. Quantities have 18 decimals.
    uint256 private constant PRICE_TIMES_QTY = 1e36;
    /// @dev A position's last crumbs are sold with it, so a sale of all but this share sells everything.
    uint256 private constant DUST = 1e9;

    /// @notice Why a trade was made.
    uint8 public constant COUNCIL = 0; // the council voted for it
    uint8 public constant STOP = 1; // a sale: the price fell to the stop-loss
    uint8 public constant TARGET = 2; // a sale: the price rose to the profit target
    uint8 public constant OWN = 3; // the agent's own decision, for its own book
    uint8 public constant FALLING = 4; // a sale: the agent judged the price to be falling fast
    uint8 private constant REASONS = 5;

    /// @notice The agent this desk belongs to, such as "The Quant".
    string public agent;
    IERC20 public immutable usdg;
    /// @notice One cent of USDG, in the token's smallest unit.
    uint256 public immutable cent;
    /// @notice Issues the receipts for this desk's positions.
    IShares public immutable shares;

    address public owner;
    /// @notice The only address that may fund the agent and record its trades.
    address public operator;
    /// @notice Takes the other side of every trade, and is where released capital goes.
    address public treasury;

    /// @notice USDG the agent is free to trade with.
    uint256 public cash;
    /// @notice USDG put into the agent and not taken out.
    uint256 public capital;
    /// @notice Gains less losses of every position closed so far. Read with `lost`.
    uint256 public gained;
    uint256 public lost;

    struct Position {
        uint256 qty;
        /// USDG paid for the quantity still held.
        uint256 cost;
        uint32 openedRound;
    }

    mapping(address => Position) private positions;
    address[] private held;
    mapping(address => uint256) private heldIndex; // place in `held`, plus one
    /// @notice Trades already on record, by id, so none is recorded twice.
    mapping(bytes32 => bool) public recorded;

    /// @notice One purchase or sale.
    struct Trade {
        /// The desk's own name for this trade. A trade is recorded once.
        bytes32 id;
        uint32 round;
        /// The token's address on Robinhood Chain. It names the asset; nothing is sent to it.
        address token;
        string symbol;
        /// USD per token, 18 decimals.
        uint256 price;
        /// Tokens bought or sold, 18 decimals.
        uint256 qty;
        /// USDG the agent puts in (a purchase) or gets back (a sale).
        uint256 usd;
        /// Why: COUNCIL, STOP, TARGET, OWN or FALLING.
        uint8 reason;
    }

    event Funded(uint256 amount, uint256 cash);
    event Released(uint256 amount, uint256 cash);
    event Bought(bytes32 indexed id, address indexed token, uint32 indexed round, Trade trade);
    /// @param qty Tokens sold. It can exceed what was asked by a few crumbs, when the sale empties the position.
    /// @param pnl What the sale brought in, less what the tokens sold had cost.
    event Sold(bytes32 indexed id, address indexed token, uint32 indexed round, Trade trade, uint256 qty, int256 pnl);
    event OperatorChanged(address operator);
    event TreasuryChanged(address treasury);
    event OwnerChanged(address owner);

    error NotOwner();
    error NotOperator();
    error NothingToDo();
    error NoSuchReason(uint8 reason);
    error NotEnoughCash(uint256 has, uint256 needs);
    error AlreadyRecorded(bytes32 id);
    error PriceDoesNotMatch(uint256 usd, uint256 expected);
    error NotHeld(address token);
    error MoreThanHeld(uint256 has, uint256 asked);
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @param usdg_ The funding token.
    /// @param usdgDecimals Its decimals. At least two, so that a cent can be counted.
    constructor(string memory agent_, IERC20 usdg_, uint8 usdgDecimals, IShares shares_, address operator_, address treasury_) {
        require(address(usdg_) != address(0) && address(shares_) != address(0) && operator_ != address(0) && treasury_ != address(0), "zero address");
        require(usdgDecimals >= 2, "too few decimals");
        agent = agent_;
        usdg = usdg_;
        cent = 10 ** (usdgDecimals - 2);
        shares = shares_;
        owner = msg.sender;
        operator = operator_;
        treasury = treasury_;
    }

    // --- capital ---

    /// @notice Puts USDG behind the agent. The USDG comes from the treasury, which must have approved it.
    function fund(uint256 amount) external onlyOperator {
        if (amount == 0) revert NothingToDo();
        cash += amount;
        capital += amount;
        _pull(amount);
        emit Funded(amount, cash);
    }

    /// @notice Takes USDG out of the agent's free cash and returns it to the treasury.
    function release(uint256 amount) external onlyOperator {
        if (amount == 0) revert NothingToDo();
        if (cash < amount) revert NotEnoughCash(cash, amount);
        cash -= amount;
        // An agent that has lost money can be left with less cash than was put in.
        capital = capital > amount ? capital - amount : 0;
        _push(amount);
        emit Released(amount, cash);
    }

    // --- trades ---

    /// @notice Opens a position, or adds to the one held in that token.
    function buy(Trade calldata t) external onlyOperator {
        if (recorded[t.id]) revert AlreadyRecorded(t.id);
        if (t.reason != COUNCIL && t.reason != OWN) revert NoSuchReason(t.reason);
        if (t.usd == 0 || t.qty == 0) revert NothingToDo();
        if (cash < t.usd) revert NotEnoughCash(cash, t.usd);
        _checkPrice(t.usd, t.price, t.qty);
        recorded[t.id] = true;

        cash -= t.usd;
        Position storage p = positions[t.token];
        if (p.qty == 0) {
            p.openedRound = t.round;
            held.push(t.token);
            heldIndex[t.token] = held.length;
        }
        p.qty += t.qty;
        p.cost += t.usd;
        emit Bought(t.id, t.token, t.round, t);
        shares.mint(t.token, t.symbol, t.qty);
    }

    /// @notice Sells part or all of a position, and settles the gain or loss with the treasury.
    function sell(Trade calldata t) external onlyOperator {
        if (recorded[t.id]) revert AlreadyRecorded(t.id);
        if (t.reason >= REASONS) revert NoSuchReason(t.reason);
        Position storage p = positions[t.token];
        if (p.qty == 0) revert NotHeld(t.token);
        if (t.qty == 0) revert NothingToDo();
        if (t.qty > p.qty + DUST) revert MoreThanHeld(p.qty, t.qty);
        recorded[t.id] = true;

        bool all = t.qty + DUST >= p.qty;
        uint256 qty = all ? p.qty : t.qty;
        _checkPrice(t.usd, t.price, qty);

        uint256 costOut = all ? p.cost : (p.cost * qty) / p.qty;
        if (all) {
            _forget(t.token);
        } else {
            p.qty -= qty;
            p.cost -= costOut;
        }
        cash += t.usd;

        int256 pnl = int256(t.usd) - int256(costOut);
        if (pnl > 0) {
            gained += uint256(pnl);
            _pull(uint256(pnl));
        } else if (pnl < 0) {
            lost += uint256(-pnl);
            _push(uint256(-pnl));
        }
        emit Sold(t.id, t.token, t.round, t, qty, pnl);
        shares.burn(t.token, qty);
    }

    // --- reading ---

    function position(address token) external view returns (uint256 qty, uint256 cost, uint32 openedRound) {
        Position storage p = positions[token];
        return (p.qty, p.cost, p.openedRound);
    }

    /// @notice Tokens the desk holds a position in.
    function holdings() external view returns (address[] memory) {
        return held;
    }

    /// @notice What the agent has made or lost on the positions it has closed.
    function result() external view returns (int256) {
        return int256(gained) - int256(lost);
    }

    /// @notice What the desk must hold: the agent's cash, plus what its open positions cost.
    function owed() public view returns (uint256 total) {
        total = cash;
        for (uint256 i = 0; i < held.length; i++) total += positions[held[i]].cost;
    }

    /// @notice True while the desk holds at least what it owes.
    function solvent() external view returns (bool) {
        return usdg.balanceOf(address(this)) >= owed();
    }

    // --- administration ---

    function setOperator(address operator_) external onlyOwner {
        require(operator_ != address(0), "zero address");
        operator = operator_;
        emit OperatorChanged(operator_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "zero address");
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    function setOwner(address owner_) external onlyOwner {
        require(owner_ != address(0), "zero address");
        owner = owner_;
        emit OwnerChanged(owner_);
    }

    /// @notice Sends the treasury whatever USDG the desk holds beyond what it owes, such as a transfer made to it by mistake.
    function sweep() external onlyOwner {
        uint256 has = usdg.balanceOf(address(this));
        uint256 owes = owed();
        if (has <= owes) revert NothingToDo();
        _push(has - owes);
    }

    // --- internals ---

    /// @dev What `qty` tokens cost at `price`, within two cents of the amount given. The amount is a whole number of cents.
    function _checkPrice(uint256 usd, uint256 price, uint256 qty) private view {
        // 100 cents to the dollar: cent * 100 is one USD in the token's units.
        uint256 expected = (price * qty * cent * 100) / PRICE_TIMES_QTY;
        uint256 gap = usd > expected ? usd - expected : expected - usd;
        if (gap > 2 * cent) revert PriceDoesNotMatch(usd, expected);
    }

    function _forget(address token) private {
        uint256 at = heldIndex[token];
        address last = held[held.length - 1];
        held[at - 1] = last;
        heldIndex[last] = at;
        held.pop();
        delete heldIndex[token];
        delete positions[token];
    }

    function _pull(uint256 amount) private {
        if (!usdg.transferFrom(treasury, address(this), amount)) revert TransferFailed();
    }

    function _push(uint256 amount) private {
        if (!usdg.transfer(treasury, amount)) revert TransferFailed();
    }
}
