// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address owner) external view returns (uint256);
}

/// @dev A Uniswap v4 pool is named by these five values. Native ETH is the zero address.
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 delta);
    function sync(address currency) external;
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
}

/// @title One agent's wallet
/// @notice Holds the money of one of the Council's AI agents, and the tokens it buys with it.
///         A trade here is a swap in a Uniswap v4 pool: the agent's money really leaves, and
///         the token really arrives. What it gains or loses, it gains from or loses to the market.
///
///         The operator may only swap, and only so much at a time. A purchase spends one of
///         the wallet's money currencies, up to the cap set for it. A sale must bring one of
///         them back. Only the owner can take anything out.
///
///         This contract has not been audited. Keep in it only what may be lost.
contract AgentWallet {
    uint160 private constant MIN_SQRT_PRICE = 4295128739;
    uint160 private constant MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342;

    /// @notice The agent this wallet belongs to, such as "The Researcher".
    string public agent;
    IPoolManager public immutable poolManager;

    address public owner;
    /// @notice The only address that may trade.
    address public operator;
    /// @notice The most of a money currency one purchase may spend. A currency with a cap is money: USDG, or ETH (the zero address).
    mapping(address => uint256) public maxSpend;

    bool private swapping;

    event Swapped(address indexed sold, address indexed bought, uint256 paid, uint256 got);
    event Withdrawn(address indexed currency, address indexed to, uint256 amount);
    event MaxSpendChanged(address indexed currency, uint256 amount);
    event OperatorChanged(address operator);
    event OwnerChanged(address owner);

    error NotOwner();
    error NotOperator();
    error NotPoolManager();
    error NothingToDo();
    error NotMoney();
    error OverTheCap(uint256 asked, uint256 cap);
    error TooLittle(uint256 got, uint256 least);
    error BadSwap();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(string memory agent_, IPoolManager poolManager_, address operator_) {
        require(address(poolManager_) != address(0) && operator_ != address(0), "zero address");
        agent = agent_;
        poolManager = poolManager_;
        owner = msg.sender;
        operator = operator_;
    }

    receive() external payable {}

    // --- trading ---

    /// @notice Swaps `amountIn` of one of a pool's two currencies for the other.
    /// @param zeroForOne True to sell the pool's first currency for its second.
    /// @param minOut The least that must come back, or the swap is undone.
    function swap(PoolKey calldata key, bool zeroForOne, uint256 amountIn, uint256 minOut) external returns (uint256 paid, uint256 got) {
        if (msg.sender != operator) revert NotOperator();
        if (amountIn == 0) revert NothingToDo();
        (address sold, address bought) = zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        // A purchase spends money, and is capped. A sale must bring money back.
        uint256 cap = maxSpend[sold];
        if (cap > 0) {
            if (amountIn > cap) revert OverTheCap(amountIn, cap);
        } else if (maxSpend[bought] == 0) {
            revert NotMoney();
        }

        swapping = true;
        (paid, got) = abi.decode(poolManager.unlock(abi.encode(key, zeroForOne, amountIn)), (uint256, uint256));
        swapping = false;
        if (got < minOut) revert TooLittle(got, minOut);
        emit Swapped(sold, bought, paid, got);
    }

    /// @notice Called by the pool manager in the middle of `swap`. It makes the swap, pays what is owed and takes what is due.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !swapping) revert NotPoolManager();
        (PoolKey memory key, bool zeroForOne, uint256 amountIn) = abi.decode(data, (PoolKey, bool, uint256));

        // A negative amount asks for exactly that much to be sold.
        int256 delta = poolManager.swap(key, SwapParams(zeroForOne, -int256(amountIn), zeroForOne ? MIN_SQRT_PRICE + 1 : MAX_SQRT_PRICE - 1), "");
        int128 first = int128(delta >> 128);
        int128 second = int128(delta);
        (int128 owed, int128 due) = zeroForOne ? (first, second) : (second, first);
        if (owed >= 0 || due <= 0) revert BadSwap();
        uint256 paid = uint256(uint128(-owed));
        uint256 got = uint256(uint128(due));
        if (paid > amountIn) revert BadSwap();

        (address sold, address bought) = zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        if (sold == address(0)) {
            poolManager.settle{value: paid}();
        } else {
            poolManager.sync(sold);
            _send(sold, address(poolManager), paid);
            poolManager.settle();
        }
        poolManager.take(bought, address(this), got);
        return abi.encode(paid, got);
    }

    // --- reading ---

    /// @notice What the wallet holds of a currency. The zero address is ETH.
    function holds(address currency) external view returns (uint256) {
        return currency == address(0) ? address(this).balance : IERC20(currency).balanceOf(address(this));
    }

    // --- administration ---

    /// @notice Takes money or tokens out of the wallet.
    function withdraw(address currency, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero address");
        if (currency == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _send(currency, to, amount);
        }
        emit Withdrawn(currency, to, amount);
    }

    /// @notice Sets the most one purchase may spend of a currency. Zero means the currency is not money here.
    function setMaxSpend(address currency, uint256 amount) external onlyOwner {
        maxSpend[currency] = amount;
        emit MaxSpendChanged(currency, amount);
    }

    function setOperator(address operator_) external onlyOwner {
        require(operator_ != address(0), "zero address");
        operator = operator_;
        emit OperatorChanged(operator_);
    }

    function setOwner(address owner_) external onlyOwner {
        require(owner_ != address(0), "zero address");
        owner = owner_;
        emit OwnerChanged(owner_);
    }

    // --- internals ---

    /// @dev Some tokens return nothing from a transfer. No answer counts as success, "false" does not.
    function _send(address token, address to, uint256 amount) private {
        (bool ok, bytes memory answer) = token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        if (!ok || (answer.length != 0 && !abi.decode(answer, (bool)))) revert TransferFailed();
    }
}
