// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentDesk, IERC20, IShares} from "../src/AgentDesk.sol";
import {CouncilShares, PositionReceipt} from "../src/CouncilShares.sol";
import {TestUSDG} from "../src/TestUSDG.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function expectRevert() external;
}

contract AgentDeskTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    TestUSDG usdg;
    CouncilShares book;
    AgentDesk quant;
    AgentDesk degen;
    address treasury = address(0xBEEF);
    address stranger = address(0xBAD);
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    uint256 constant USD = 1e6;
    uint256 constant CENT = 1e4;

    function setUp() public {
        usdg = new TestUSDG();
        usdg.mint(treasury, 10_000 * USD);
        book = new CouncilShares();
        quant = new AgentDesk("The Quant", IERC20(address(usdg)), 6, IShares(address(book)), treasury, treasury);
        degen = new AgentDesk("The Degen", IERC20(address(usdg)), 6, IShares(address(book)), treasury, treasury);
        book.setDesk(address(quant), true);
        book.setDesk(address(degen), true);
        vm.startPrank(treasury);
        usdg.approve(address(quant), type(uint256).max);
        usdg.approve(address(degen), type(uint256).max);
        quant.fund(100 * USD);
        degen.fund(100 * USD);
        vm.stopPrank();
    }

    function eq(uint256 a, uint256 b, string memory what) internal pure { require(a == b, what); }
    function backed(AgentDesk d) internal view { require(usdg.balanceOf(address(d)) == d.owed(), "desk holds exactly what it owes"); require(d.solvent(), "solvent"); }
    function id(string memory s) internal pure returns (bytes32) { return keccak256(bytes(s)); }
    function trade(string memory name, address token, string memory symbol, uint256 price, uint256 qty, uint256 cents, uint8 reason) internal pure returns (AgentDesk.Trade memory) {
        return AgentDesk.Trade(id(name), 1, token, symbol, price, qty, cents * CENT, reason);
    }
    function receipts(address token, AgentDesk d) internal view returns (uint256) { return book.receiptOf(token).balanceOf(address(d)); }

    function testEachDeskHoldsItsOwnFunding() public view {
        eq(usdg.balanceOf(address(quant)), 100 * USD, "balance");
        eq(quant.cash(), 100 * USD, "cash");
        eq(quant.capital(), 100 * USD, "capital");
        require(keccak256(bytes(quant.agent())) == keccak256("The Quant"), "name");
        backed(quant);
        backed(degen);
    }

    function testOnlyTheOperatorTrades() public {
        vm.prank(stranger);
        vm.expectRevert(AgentDesk.NotOperator.selector);
        quant.fund(USD);
        vm.prank(stranger);
        vm.expectRevert(AgentDesk.NotOperator.selector);
        quant.buy(trade("a", TSLA, "TSLA", 350e18, 1e17, 3500, 3));
        vm.prank(stranger);
        vm.expectRevert(AgentDesk.NotOwner.selector);
        quant.setOperator(stranger);
    }

    function testBuyTakesCashOpensAPositionAndIssuesAReceipt() public {
        // $35 of TSLA at $350: 0.1 tokens, for the Quant's own book.
        vm.prank(treasury);
        quant.buy(trade("r1", TSLA, "TSLA", 350e18, 1e17, 3500, 3));
        eq(quant.cash(), 65 * USD, "cash");
        (uint256 qty, uint256 cost, uint32 round) = quant.position(TSLA);
        eq(qty, 1e17, "qty"); eq(cost, 35 * USD, "cost"); eq(round, 1, "round");
        eq(quant.holdings().length, 1, "held");
        eq(receipts(TSLA, quant), 1e17, "receipt");
        PositionReceipt r = book.receiptOf(TSLA);
        require(keccak256(bytes(r.symbol())) == keccak256("cTSLA"), "receipt symbol");
        require(r.asset() == TSLA, "receipt asset");
        backed(quant);
        // The other desk is untouched.
        eq(degen.cash(), 100 * USD, "degen cash");
        eq(degen.holdings().length, 0, "degen held");
    }

    function testTwoDesksShareOneKindOfReceipt() public {
        vm.startPrank(treasury);
        quant.buy(trade("c1-quant", TSLA, "TSLA", 350e18, 1e17, 3500, 0));
        degen.buy(trade("c1-degen", TSLA, "TSLA", 350e18, 2e17, 7000, 0));
        vm.stopPrank();
        eq(receipts(TSLA, quant), 1e17, "quant receipt");
        eq(receipts(TSLA, degen), 2e17, "degen receipt");
        eq(book.receiptOf(TSLA).totalSupply(), 3e17, "supply");
        eq(book.tokens().length, 1, "one receipt");
        backed(quant);
        backed(degen);
    }

    function testAnAgentCannotSpendMoreThanItsCash() public {
        vm.prank(treasury);
        vm.expectRevert();
        quant.buy(trade("r1", TSLA, "TSLA", 350e18, 1e18, 35000, 3));
    }

    function testThePriceMustMatchTheMoney() public {
        // $35 can't buy a whole token at $350.
        vm.prank(treasury);
        vm.expectRevert();
        quant.buy(trade("r1", TSLA, "TSLA", 350e18, 1e18, 3500, 3));
    }

    function testATradeIsRecordedOnce() public {
        vm.startPrank(treasury);
        quant.buy(trade("r1", TSLA, "TSLA", 350e18, 1e17, 3500, 3));
        vm.expectRevert();
        quant.buy(trade("r1", TSLA, "TSLA", 350e18, 1e17, 3500, 3));
        vm.stopPrank();
        eq(quant.cash(), 65 * USD, "cash");
    }

    function testAPurchaseCannotBeAStop() public {
        vm.prank(treasury);
        vm.expectRevert();
        quant.buy(trade("r1", TSLA, "TSLA", 350e18, 1e17, 3500, 1));
    }

    function testSellingAtAGainIsPaidByTheTreasury() public {
        vm.startPrank(treasury);
        quant.buy(trade("r1", TSLA, "TSLA", 350e18, 1e17, 3500, 3));
        uint256 before = usdg.balanceOf(treasury);
        // Sold at $385: 0.1 tokens bring $38.50, a gain of $3.50.
        quant.sell(trade("r2", TSLA, "TSLA", 385e18, 1e17, 3850, 2));
        vm.stopPrank();
        eq(quant.cash(), 10350 * CENT, "cash");
        eq(before - usdg.balanceOf(treasury), 350 * CENT, "treasury paid the gain");
        eq(quant.holdings().length, 0, "closed");
        eq(receipts(TSLA, quant), 0, "receipt cancelled");
        require(quant.result() == int256(350 * CENT), "result");
        backed(quant);
    }

    function testSellingAtALossPaysTheTreasury() public {
        vm.startPrank(treasury);
        quant.buy(trade("r1", TSLA, "TSLA", 350e18, 1e17, 3500, 3));
        uint256 before = usdg.balanceOf(treasury);
        // The agent judged it to be falling, and sold at $315: a loss of $3.50.
        quant.sell(trade("r2", TSLA, "TSLA", 315e18, 1e17, 3150, 4));
        vm.stopPrank();
        eq(quant.cash(), 9650 * CENT, "cash");
        eq(usdg.balanceOf(treasury) - before, 350 * CENT, "treasury got the loss");
        require(quant.result() == -int256(350 * CENT), "result");
        backed(quant);
    }

    function testSellingPartKeepsTheRest() public {
        vm.startPrank(treasury);
        quant.buy(trade("r1", MSFT, "MSFT", 500e18, 1e17, 5000, 3));
        // Half is sold at $520.
        quant.sell(trade("r2", MSFT, "MSFT", 520e18, 5e16, 2600, 3));
        vm.stopPrank();
        (uint256 qty, uint256 cost,) = quant.position(MSFT);
        eq(qty, 5e16, "qty left"); eq(cost, 25 * USD, "cost left");
        eq(quant.cash(), 76 * USD, "cash");
        eq(receipts(MSFT, quant), 5e16, "receipt left");
        backed(quant);
    }

    function testTheLastCrumbsAreSoldWithThePosition() public {
        vm.startPrank(treasury);
        quant.buy(trade("r1", MSFT, "MSFT", 500e18, 1e17, 5000, 3));
        quant.sell(trade("r2", MSFT, "MSFT", 500e18, 1e17 - 5, 5000, 0));
        vm.stopPrank();
        eq(quant.holdings().length, 0, "closed");
        eq(receipts(MSFT, quant), 0, "no receipt left");
        eq(quant.cash(), 100 * USD, "cash");
        backed(quant);
    }

    function testMoreThanIsHeldCannotBeSold() public {
        vm.startPrank(treasury);
        quant.buy(trade("r1", MSFT, "MSFT", 500e18, 1e17, 5000, 3));
        vm.expectRevert();
        quant.sell(trade("r2", MSFT, "MSFT", 500e18, 2e17, 10000, 0));
        vm.expectRevert();
        degen.sell(trade("r3", MSFT, "MSFT", 500e18, 1e17, 5000, 0));
        vm.stopPrank();
    }

    function testATokenWorthAMillionthOfACent() public {
        vm.startPrank(treasury);
        // $20 at $0.000006541 a token: 3,057,636.4 tokens.
        uint256 price = 6541e9;
        uint256 qty = (20e18 * 1e18) / price;
        degen.buy(trade("m1", address(0x1234), "SHCAT", price, qty, 2000, 3));
        degen.sell(trade("m2", address(0x1234), "SHCAT", price * 2, qty, 4000, 2));
        vm.stopPrank();
        eq(degen.cash(), 120 * USD, "cash");
        backed(degen);
    }

    function testHoldingsAreKeptInOrderWhenOneIsClosed() public {
        vm.startPrank(treasury);
        quant.buy(trade("a", TSLA, "TSLA", 350e18, 1e17, 3500, 3));
        quant.buy(trade("b", MSFT, "MSFT", 500e18, 4e16, 2000, 0));
        quant.sell(trade("c", TSLA, "TSLA", 350e18, 1e17, 3500, 1));
        vm.stopPrank();
        address[] memory h = quant.holdings();
        eq(h.length, 1, "one left");
        require(h[0] == MSFT, "MSFT left");
        backed(quant);
    }

    function testReleaseReturnsCashToTheTreasury() public {
        uint256 before = usdg.balanceOf(treasury);
        vm.startPrank(treasury);
        quant.release(40 * USD);
        vm.expectRevert();
        quant.release(61 * USD);
        vm.stopPrank();
        eq(usdg.balanceOf(treasury) - before, 40 * USD, "returned");
        eq(quant.cash(), 60 * USD, "cash");
        eq(quant.capital(), 60 * USD, "capital");
        backed(quant);
    }

    function testReceiptsCannotBeMovedOrIssuedByAStranger() public {
        vm.prank(treasury);
        quant.buy(trade("r1", TSLA, "TSLA", 350e18, 1e17, 3500, 3));
        PositionReceipt r = book.receiptOf(TSLA);
        vm.prank(address(quant));
        vm.expectRevert(PositionReceipt.ReceiptsDoNotMove.selector);
        r.transfer(stranger, 1);
        vm.prank(stranger);
        vm.expectRevert(PositionReceipt.NotTheBook.selector);
        r.issue(stranger, 1e18);
        vm.prank(stranger);
        vm.expectRevert(CouncilShares.NotADesk.selector);
        book.mint(TSLA, "TSLA", 1e18);
        vm.prank(stranger);
        vm.expectRevert(CouncilShares.NotOwner.selector);
        book.setDesk(stranger, true);
    }

    function testSweepReturnsWhatWasSentByMistake() public {
        usdg.mint(address(quant), 5 * USD);
        uint256 before = usdg.balanceOf(treasury);
        quant.sweep();
        eq(usdg.balanceOf(treasury) - before, 5 * USD, "swept");
        backed(quant);
    }
}
