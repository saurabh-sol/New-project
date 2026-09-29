// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address owner) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title The Council's trading desk
/// @notice Holds the USDG of four AI agents and keeps their trades on record.
///
///         A trade here is not a swap on a market. The desk buys and sells at the live price
///         its operator reports, and the treasury takes the other side: when a position is
///         closed at a gain the treasury pays the gain in, and at a loss the desk pays the
///         loss out. So the USDG held here always equals the agents' cash plus what their
///         open positions cost.
///
///         The operator is trusted to report true prices. This contract has not been audited
///         and is meant for a testnet.
contract CouncilDesk {
    uint8 public constant AGENTS = 4;

    /// @dev Prices are USD with 18 decimals, fine enough for a token worth a millionth of a cent. Quantities have 18 decimals.
    uint256 private constant PRICE_TIMES_QTY = 1e36;
    /// @dev A position's last crumbs are sold with it, so a sale of all but this share sells everything.
    uint256 private constant DUST = 1e9;

    IERC20 public immutable usdg;
    /// @notice One cent of USDG, in the token's smallest unit.
    uint256 public immutable cent;

    address public owner;
    /// @notice The only address that may fund agents and record trades.
    address public operator;
    /// @notice Takes the other side of every trade, and is where released capital goes.
    address public treasury;

    /// @notice USDG each agent is free to trade with.
    uint256[4] public cash;
    /// @notice USDG put into each agent and not taken out.
    uint256[4] public capital;

    struct Position {
        uint256 qty;
        /// USDG paid for the quantity still held.
        uint256 cost;
        /// Each agent's share of `cost`.
        uint256[4] stake;
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
        /// USDG each agent puts in (a purchase) or gets back (a sale). Their sum is what the trade is worth.
        uint256[4] amounts;
        /// A purchase: the agent who led it. A sale: 0 if the council voted, 1 for a stop-loss, 2 for a profit target.
        uint8 tag;
    }

    event Funded(uint8 indexed agent, uint256 amount, uint256 cash);
    event Released(uint8 indexed agent, uint256 amount, uint256 cash);
    /// @param usd What the purchase cost: the sum of the agents' stakes.
    event Bought(bytes32 indexed id, address indexed token, uint32 indexed round, Trade trade, uint256 usd);
    /// @param qty Tokens sold. It can exceed what was asked by a few crumbs, when the sale empties the position.
    /// @param usd What the sale brought in: the sum of the agents' payouts.
    /// @param pnl What the sale brought in, less what the tokens sold had cost.
    event Sold(bytes32 indexed id, address indexed token, uint32 indexed round, Trade trade, uint256 qty, uint256 usd, int256 pnl);
    event OperatorChanged(address operator);
    event TreasuryChanged(address treasury);
    event OwnerChanged(address owner);

    error NotOwner();
    error NotOperator();
    error NoSuchAgent();
    error NothingToDo();
    error NotEnoughCash(uint8 agent, uint256 has, uint256 needs);
    error AlreadyRecorded(bytes32 id);
    error PriceDoesNotMatch(uint256 usd, uint256 expected);
    error NotHeld(address token);
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
    constructor(IERC20 usdg_, uint8 usdgDecimals, address operator_, address treasury_) {
        require(address(usdg_) != address(0) && operator_ != address(0) && treasury_ != address(0), "zero address");
        require(usdgDecimals >= 2, "too few decimals");
        usdg = usdg_;
        cent = 10 ** (usdgDecimals - 2);
        owner = msg.sender;
        operator = operator_;
        treasury = treasury_;
    }

    // --- capital ---

    /// @notice Puts USDG behind an agent. The USDG comes from the treasury, which must have approved it.
    function fund(uint8 agent, uint256 amount) external onlyOperator {
        if (agent >= AGENTS) revert NoSuchAgent();
        if (amount == 0) revert NothingToDo();
        cash[agent] += amount;
        capital[agent] += amount;
        _pull(amount);
        emit Funded(agent, amount, cash[agent]);
    }

    /// @notice Takes USDG out of an agent's free cash and returns it to the treasury.
    function release(uint8 agent, uint256 amount) external onlyOperator {
        if (agent >= AGENTS) revert NoSuchAgent();
        if (amount == 0) revert NothingToDo();
        if (cash[agent] < amount) revert NotEnoughCash(agent, cash[agent], amount);
        cash[agent] -= amount;
        // An agent that has lost money can be left with less cash than was put in.
        capital[agent] = capital[agent] > amount ? capital[agent] - amount : 0;
        _push(amount);
        emit Released(agent, amount, cash[agent]);
    }

    // --- trades ---

    /// @notice Opens a position, or adds to the one held in that token.
    function buy(Trade calldata t) external onlyOperator {
        if (recorded[t.id]) revert AlreadyRecorded(t.id);
        if (t.tag >= AGENTS) revert NoSuchAgent();
        recorded[t.id] = true;

        Position storage p = positions[t.token];
        uint256 usd;
        for (uint8 a = 0; a < AGENTS; a++) {
            uint256 s = t.amounts[a];
            if (s == 0) continue;
            if (cash[a] < s) revert NotEnoughCash(a, cash[a], s);
            cash[a] -= s;
            p.stake[a] += s;
            usd += s;
        }
        if (usd == 0 || t.qty == 0) revert NothingToDo();
        _checkPrice(usd, t.price, t.qty, cent);

        if (p.qty == 0) {
            p.openedRound = t.round;
            held.push(t.token);
            heldIndex[t.token] = held.length;
        }
        p.qty += t.qty;
        p.cost += usd;
        emit Bought(t.id, t.token, t.round, t, usd);
    }

    /// @notice Sells part or all of a position. Each agent is paid its share, and the gain or loss is settled with the treasury.
    function sell(Trade calldata t) external onlyOperator {
        if (recorded[t.id]) revert AlreadyRecorded(t.id);
        recorded[t.id] = true;

        Position storage p = positions[t.token];
        if (p.qty == 0) revert NotHeld(t.token);
        if (t.qty == 0) revert NothingToDo();
        bool all = t.qty + DUST >= p.qty;
        uint256 qty = all ? p.qty : t.qty;

        uint256 usd = _payOut(p, t.amounts, qty, all);
        // Each agent's payout is rounded to the cent on its own, so the sum can be a few cents off.
        _checkPrice(usd, t.price, qty, cent * (AGENTS + 1));

        uint256 costOut = all ? p.cost : (p.cost * qty) / p.qty;
        if (all) {
            _forget(t.token);
        } else {
            p.qty -= qty;
            p.cost -= costOut;
        }

        int256 pnl = int256(usd) - int256(costOut);
        if (pnl > 0) _pull(uint256(pnl));
        else if (pnl < 0) _push(uint256(-pnl));
        emit Sold(t.id, t.token, t.round, t, qty, usd, pnl);
    }

    /// @dev Credits each agent its payout and reduces its stake by the share sold. Returns what the sale brought in.
    function _payOut(Position storage p, uint256[4] calldata payouts, uint256 qty, bool all) private returns (uint256 usd) {
        for (uint8 a = 0; a < AGENTS; a++) {
            // An agent with no stake in the position has no claim on what it brings in.
            if (p.stake[a] == 0 && payouts[a] != 0) revert NotEnoughCash(a, 0, payouts[a]);
            p.stake[a] = all ? 0 : p.stake[a] - (p.stake[a] * qty) / p.qty;
            cash[a] += payouts[a];
            usd += payouts[a];
        }
    }

    // --- reading ---

    function position(address token) external view returns (uint256 qty, uint256 cost, uint256[4] memory stake, uint32 openedRound) {
        Position storage p = positions[token];
        return (p.qty, p.cost, p.stake, p.openedRound);
    }

    /// @notice Tokens the desk holds a position in.
    function holdings() external view returns (address[] memory) {
        return held;
    }

    function balances() external view returns (uint256[4] memory cash_, uint256[4] memory capital_) {
        return (cash, capital);
    }

    /// @notice What the desk must hold: the agents' cash, plus what their open positions cost.
    function owed() public view returns (uint256 total) {
        for (uint8 a = 0; a < AGENTS; a++) total += cash[a];
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

    /// @dev What `qty` tokens cost at `price`, within `tolerance` of the amount given.
    function _checkPrice(uint256 usd, uint256 price, uint256 qty, uint256 tolerance) private view {
        // 100 cents to the dollar: cent * 100 is one USD in the token's units.
        uint256 expected = (price * qty * cent * 100) / PRICE_TIMES_QTY;
        uint256 gap = usd > expected ? usd - expected : expected - usd;
        if (gap > tolerance) revert PriceDoesNotMatch(usd, expected);
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
