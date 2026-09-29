// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CouncilDesk, IERC20} from "../src/CouncilDesk.sol";
import {TestUSDG} from "../src/TestUSDG.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function expectRevert() external;
}

contract CouncilDeskTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    TestUSDG usdg;
    CouncilDesk desk;
    address treasury = address(0xBEEF);
    address stranger = address(0xBAD);
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    uint256 constant USD = 1e6;

    function setUp() public {
        usdg = new TestUSDG();
        usdg.mint(treasury, 10_000 * USD);
        desk = new CouncilDesk(IERC20(address(usdg)), 6, treasury, treasury);
        vm.startPrank(treasury);
        usdg.approve(address(desk), type(uint256).max);
        for (uint8 a = 0; a < 4; a++) desk.fund(a, 100 * USD);
        vm.stopPrank();
    }

    function eq(uint256 a, uint256 b, string memory what) internal pure { require(a == b, what); }
    function backed() internal view { require(usdg.balanceOf(address(desk)) == desk.owed(), "desk holds exactly what it owes"); require(desk.solvent(), "solvent"); }
    function stakes(uint256 q, uint256 d, uint256 g, uint256 o) internal pure returns (uint256[4] memory s) { s = [q * USD / 100, d * USD / 100, g * USD / 100, o * USD / 100]; }

    function testFundingIsHeldByTheDesk() public view {
        eq(usdg.balanceOf(address(desk)), 400 * USD, "balance");
        eq(desk.cash(2), 100 * USD, "cash");
        eq(desk.capital(2), 100 * USD, "capital");
        backed();
    }

    function testOnlyTheOperatorTrades() public {
        vm.prank(stranger);
        vm.expectRevert(CouncilDesk.NotOperator.selector);
        desk.fund(0, USD);
        vm.prank(stranger);
        vm.expectRevert(CouncilDesk.NotOperator.selector);
        desk.buy(CouncilDesk.Trade(bytes32(bytes("a")), 1, TSLA, "TSLA", 350e18, 1e17, stakes(3500, 0, 0, 0), 0));
        vm.prank(stranger);
        vm.expectRevert(CouncilDesk.NotOwner.selector);
        desk.setOperator(stranger);
    }

    function testBuyTakesCashAndOpensAPosition() public {
        // $35 of TSLA at $350: 0.1 tokens. Quant puts in $25, Guardian $10.
        vm.prank(treasury);
        desk.buy(CouncilDesk.Trade(bytes32(bytes("r1")), 1, TSLA, "TSLA", 350e18, 1e17, stakes(2500, 0, 1000, 0), 0));
        eq(desk.cash(0), 75 * USD, "quant cash");
        eq(desk.cash(2), 90 * USD, "guardian cash");
        (uint256 qty, uint256 cost, uint256[4] memory stake, uint32 round) = desk.position(TSLA);
        eq(qty, 1e17, "qty"); eq(cost, 35 * USD, "cost"); eq(stake[0], 25 * USD, "stake"); eq(round, 1, "round");
        eq(desk.holdings().length, 1, "held");
        backed();
    }

    function testAnAgentCannotSpendMoreThanItsCash() public {
        vm.prank(treasury);
        vm.expectRevert();
        desk.buy(CouncilDesk.Trade(bytes32(bytes("r1")), 1, TSLA, "TSLA", 350e18, 1e18, stakes(35000, 0, 0, 0), 0));
    }

    function testThePriceMustMatchTheMoney() public {
        // $35 can't buy a whole token at $350.
        vm.prank(treasury);
        vm.expectRevert();
        desk.buy(CouncilDesk.Trade(bytes32(bytes("r1")), 1, TSLA, "TSLA", 350e18, 1e18, stakes(3500, 0, 0, 0), 0));
    }

    function testATradeIsRecordedOnce() public {
        vm.startPrank(treasury);
        desk.buy(CouncilDesk.Trade(bytes32(bytes("r1")), 1, TSLA, "TSLA", 350e18, 1e17, stakes(3500, 0, 0, 0), 0));
        vm.expectRevert();
        desk.buy(CouncilDesk.Trade(bytes32(bytes("r1")), 1, TSLA, "TSLA", 350e18, 1e17, stakes(3500, 0, 0, 0), 0));
        vm.stopPrank();
    }

    function testAGainIsPaidInByTheTreasury() public {
        vm.startPrank(treasury);
        desk.buy(CouncilDesk.Trade(bytes32(bytes("r1")), 1, TSLA, "TSLA", 350e18, 1e17, stakes(2500, 0, 1000, 0), 0));
        uint256 before = usdg.balanceOf(treasury);
        // Sold at $385, up 10%: $38.50. Quant gets 25/35 of it, Guardian 10/35.
        desk.sell(CouncilDesk.Trade(bytes32(bytes("r3")), 3, TSLA, "TSLA", 385e18, 1e17, stakes(2750, 0, 1100, 0), 0));
        vm.stopPrank();
        eq(before - usdg.balanceOf(treasury), 350 * USD / 100, "treasury paid the gain");
        eq(desk.cash(0), 10250 * USD / 100, "quant cash");
        eq(desk.cash(2), 101 * USD, "guardian cash");
        eq(desk.holdings().length, 0, "nothing held");
        backed();
    }

    function testALossIsPaidOutToTheTreasury() public {
        vm.startPrank(treasury);
        desk.buy(CouncilDesk.Trade(bytes32(bytes("r1")), 1, TSLA, "TSLA", 350e18, 1e17, stakes(3500, 0, 0, 0), 0));
        uint256 before = usdg.balanceOf(treasury);
        // Stopped out 6% lower, at $329: $32.90.
        desk.sell(CouncilDesk.Trade(bytes32(bytes("stop")), 2, TSLA, "TSLA", 329e18, 1e17, stakes(3290, 0, 0, 0), 1));
        vm.stopPrank();
        eq(usdg.balanceOf(treasury) - before, 210 * USD / 100, "treasury took the loss");
        eq(desk.cash(0), 9790 * USD / 100, "quant cash");
        backed();
    }

    function testHalfCanBeSoldAndTheRestKept() public {
        vm.startPrank(treasury);
        desk.buy(CouncilDesk.Trade(bytes32(bytes("r1")), 1, MSFT, "MSFT", 500e18, 1e17, stakes(3000, 2000, 0, 0), 0));
        desk.sell(CouncilDesk.Trade(bytes32(bytes("r3")), 3, MSFT, "MSFT", 520e18, 5e16, stakes(1560, 1040, 0, 0), 0));
        vm.stopPrank();
        (uint256 qty, uint256 cost, uint256[4] memory stake,) = desk.position(MSFT);
        eq(qty, 5e16, "qty"); eq(cost, 25 * USD, "cost"); eq(stake[0], 15 * USD, "quant stake"); eq(stake[1], 10 * USD, "degen stake");
        backed();
    }

    function testAddingToAPositionKeepsItsFirstRound() public {
        vm.startPrank(treasury);
        desk.buy(CouncilDesk.Trade(bytes32(bytes("r1")), 1, MSFT, "MSFT", 500e18, 5e16, stakes(2500, 0, 0, 0), 0));
        desk.buy(CouncilDesk.Trade(bytes32(bytes("r2")), 2, MSFT, "MSFT", 510e18, 5e16, stakes(0, 2550, 0, 0), 1));
        vm.stopPrank();
        (uint256 qty, uint256 cost,, uint32 round) = desk.position(MSFT);
        eq(qty, 1e17, "qty"); eq(cost, 5050 * USD / 100, "cost"); eq(round, 1, "round");
        eq(desk.holdings().length, 1, "one holding");
        backed();
    }

    function testAnAgentWithNoStakeGetsNothing() public {
        vm.startPrank(treasury);
        desk.buy(CouncilDesk.Trade(bytes32(bytes("r1")), 1, TSLA, "TSLA", 350e18, 1e17, stakes(3500, 0, 0, 0), 0));
        vm.expectRevert();
        desk.sell(CouncilDesk.Trade(bytes32(bytes("r3")), 3, TSLA, "TSLA", 350e18, 1e17, stakes(0, 3500, 0, 0), 0));
        vm.stopPrank();
    }

    function testWhatIsNotHeldCannotBeSold() public {
        vm.prank(treasury);
        vm.expectRevert();
        desk.sell(CouncilDesk.Trade(bytes32(bytes("r3")), 3, TSLA, "TSLA", 350e18, 1e17, stakes(3500, 0, 0, 0), 0));
    }

    function testReleaseReturnsCashToTheTreasury() public {
        vm.startPrank(treasury);
        uint256 before = usdg.balanceOf(treasury);
        desk.release(1, 40 * USD);
        eq(usdg.balanceOf(treasury) - before, 40 * USD, "returned");
        eq(desk.cash(1), 60 * USD, "cash"); eq(desk.capital(1), 60 * USD, "capital");
        vm.expectRevert();
        desk.release(1, 61 * USD);
        vm.stopPrank();
        backed();
    }

    function testSweepOnlyTakesWhatIsNotOwed() public {
        vm.prank(treasury);
        usdg.transfer(address(desk), 7 * USD);
        uint256 before = usdg.balanceOf(treasury);
        desk.sweep();
        eq(usdg.balanceOf(treasury) - before, 7 * USD, "swept the stray transfer");
        backed();
        vm.expectRevert(CouncilDesk.NothingToDo.selector);
        desk.sweep();
    }

    function testManyTradesLeaveTheDeskExactlyBacked() public {
        vm.startPrank(treasury);
        desk.buy(CouncilDesk.Trade(bytes32(bytes("1")), 1, TSLA, "TSLA", 357310000000000000000, 97954157454311382, stakes(2500, 1000, 0, 0), 0));
        backed();
        desk.buy(CouncilDesk.Trade(bytes32(bytes("2")), 2, MSFT, "MSFT", 507310000000000000000, 49279533224261300, stakes(0, 0, 2500, 0), 2));
        backed();
        // A third of the TSLA at a small gain, paid out by stake: 25/35 and 10/35 of $11.76.
        desk.sell(CouncilDesk.Trade(bytes32(bytes("3")), 4, TSLA, "TSLA", 360110000000000000000, 32651385818103794, stakes(840, 336, 0, 0), 0));
        backed();
        desk.sell(CouncilDesk.Trade(bytes32(bytes("4")), 5, MSFT, "MSFT", 476871400000000000000, 49279533224261300, stakes(0, 0, 2350, 0), 1));
        backed();
        desk.sell(CouncilDesk.Trade(bytes32(bytes("5")), 6, TSLA, "TSLA", 393041000000000000000, 65302771636207588, stakes(1833, 733, 0, 0), 2));
        vm.stopPrank();
        eq(desk.holdings().length, 0, "all closed");
        backed();
    }
}
