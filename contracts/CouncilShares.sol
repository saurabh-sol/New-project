// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title A receipt for a position held by one of the Council's agents
/// @notice Shows in an agent's desk how much of a token the agent holds a position in.
///         It is a record, not the token it names: it can't be exchanged for that token,
///         and it can't be moved from the desk it was issued to.
contract PositionReceipt {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    /// @notice The token on Robinhood Chain that these receipts are for.
    address public immutable asset;
    /// @notice The share book, which alone may issue and cancel receipts.
    address public immutable book;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error NotTheBook();
    error ReceiptsDoNotMove();

    constructor(address asset_, string memory symbol_) {
        asset = asset_;
        book = msg.sender;
        name = string.concat("The Council: position in ", symbol_);
        symbol = string.concat("c", symbol_);
    }

    modifier onlyBook() {
        if (msg.sender != book) revert NotTheBook();
        _;
    }

    function issue(address to, uint256 qty) external onlyBook {
        totalSupply += qty;
        balanceOf[to] += qty;
        emit Transfer(address(0), to, qty);
    }

    function cancel(address from, uint256 qty) external onlyBook {
        balanceOf[from] -= qty;
        totalSupply -= qty;
        emit Transfer(from, address(0), qty);
    }

    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert ReceiptsDoNotMove();
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert ReceiptsDoNotMove();
    }

    function approve(address, uint256) external pure returns (bool) {
        revert ReceiptsDoNotMove();
    }
}

/// @title The Council's share book
/// @notice Issues a receipt to an agent's desk when the agent buys, and cancels it when the agent sells.
///         There is one kind of receipt for each token the agents have held, shared by their desks.
contract CouncilShares {
    address public owner;
    /// @notice The agents' desks, which alone may ask for receipts.
    mapping(address => bool) public isDesk;
    /// @notice The receipt for each token.
    mapping(address => PositionReceipt) public receiptOf;
    address[] private assets;

    event DeskSet(address indexed desk, bool allowed);
    event ReceiptCreated(address indexed asset, address receipt, string symbol);
    event OwnerChanged(address owner);

    error NotOwner();
    error NotADesk();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyDesk() {
        if (!isDesk[msg.sender]) revert NotADesk();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setDesk(address desk, bool allowed) external onlyOwner {
        isDesk[desk] = allowed;
        emit DeskSet(desk, allowed);
    }

    function setOwner(address owner_) external onlyOwner {
        require(owner_ != address(0), "zero address");
        owner = owner_;
        emit OwnerChanged(owner_);
    }

    /// @notice Issues receipts for `qty` of `asset` to the desk that calls. The first purchase of a token creates its receipt.
    function mint(address asset, string calldata symbol, uint256 qty) external onlyDesk returns (address) {
        PositionReceipt receipt = receiptOf[asset];
        if (address(receipt) == address(0)) {
            receipt = new PositionReceipt(asset, symbol);
            receiptOf[asset] = receipt;
            assets.push(asset);
            emit ReceiptCreated(asset, address(receipt), symbol);
        }
        receipt.issue(msg.sender, qty);
        return address(receipt);
    }

    /// @notice Cancels receipts for `qty` of `asset` held by the desk that calls.
    function burn(address asset, uint256 qty) external onlyDesk {
        receiptOf[asset].cancel(msg.sender, qty);
    }

    /// @notice Every token a receipt has been created for.
    function tokens() external view returns (address[] memory) {
        return assets;
    }
}
