// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";

import { PrizeEscrow } from "../src/PrizeEscrow.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";

/// @dev The test contract holds CONTROLLER_ROLE and acts as the controller, so
///      it can call the escrow directly the way ContestEngine/ChallengeArena do.
contract PrizeEscrowTest is Test {
    PrizeEscrow internal escrow;
    MockUSDC internal usdc;

    address internal admin = address(this);
    address internal treasury = makeAddr("treasury");
    address internal sponsor = makeAddr("sponsor");
    address internal winner = makeAddr("winner");
    address internal controller2 = makeAddr("controller2");

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new PrizeEscrow(admin, address(usdc), treasury);
        escrow.grantRole(escrow.CONTROLLER_ROLE(), address(this));
        escrow.grantRole(escrow.CONTROLLER_ROLE(), controller2);
    }

    function _fundAndApprove(address from, uint256 amount) internal {
        usdc.mint(from, amount);
        vm.prank(from);
        usdc.approve(address(escrow), amount);
    }

    function test_depositPrizePool_pullsAndAccounts() public {
        _fundAndApprove(sponsor, 1000e6);
        escrow.depositPrizePool(1, sponsor, 1000e6);
        assertEq(escrow.poolBalance(address(this), 1), 1000e6);
        assertEq(usdc.balanceOf(address(escrow)), 1000e6);
    }

    function test_collectListingFee_goesToTreasury() public {
        _fundAndApprove(sponsor, 5e6);
        escrow.collectListingFee(sponsor, 5e6);
        assertEq(usdc.balanceOf(treasury), 5e6);
        assertEq(escrow.poolBalance(address(this), 1), 0, "fee is not pooled");
    }

    function test_payout_decrementsPool() public {
        _fundAndApprove(sponsor, 1000e6);
        escrow.depositPrizePool(1, sponsor, 1000e6);

        escrow.payout(1, winner, 400e6);
        assertEq(usdc.balanceOf(winner), 400e6);
        assertEq(escrow.poolBalance(address(this), 1), 600e6);
    }

    function test_payout_revertsOnInsufficientBalance() public {
        _fundAndApprove(sponsor, 100e6);
        escrow.depositPrizePool(1, sponsor, 100e6);
        vm.expectRevert(abi.encodeWithSelector(PrizeEscrow.InsufficientPoolBalance.selector, uint256(100e6), uint256(200e6)));
        escrow.payout(1, winner, 200e6);
    }

    function test_skimPlatformFee_toTreasury() public {
        _fundAndApprove(sponsor, 1000e6);
        escrow.depositPrizePool(1, sponsor, 1000e6);
        escrow.skimPlatformFee(1, 50e6);
        assertEq(usdc.balanceOf(treasury), 50e6);
        assertEq(escrow.poolBalance(address(this), 1), 950e6);
    }

    function test_sweepUnclaimed_emptiesPool() public {
        _fundAndApprove(sponsor, 1000e6);
        escrow.depositPrizePool(1, sponsor, 1000e6);
        escrow.sweepUnclaimed(1);
        assertEq(usdc.balanceOf(treasury), 1000e6);
        assertEq(escrow.poolBalance(address(this), 1), 0);
    }

    function test_sweepUnclaimed_revertsWhenEmpty() public {
        vm.expectRevert(PrizeEscrow.ZeroAmount.selector);
        escrow.sweepUnclaimed(99);
    }

    function test_poolsAreNamespacedByController() public {
        _fundAndApprove(sponsor, 300e6);
        escrow.depositPrizePool(1, sponsor, 300e6); // controller = this

        address other = makeAddr("other");
        usdc.mint(other, 700e6);
        vm.prank(other);
        usdc.approve(address(escrow), 700e6);
        vm.prank(controller2);
        escrow.depositPrizePool(1, other, 700e6); // same poolId, different controller

        assertEq(escrow.poolBalance(address(this), 1), 300e6);
        assertEq(escrow.poolBalance(controller2, 1), 700e6);

        // controller2 cannot overdraw this contract's pool: its own pool caps it
        vm.prank(controller2);
        escrow.payout(1, winner, 700e6);
        assertEq(escrow.poolBalance(address(this), 1), 300e6, "untouched");
    }

    function test_onlyController_canDeposit() public {
        _fundAndApprove(sponsor, 100e6);
        vm.prank(sponsor);
        vm.expectRevert();
        escrow.depositPrizePool(1, sponsor, 100e6);
    }

    function test_setTreasury_onlyAdmin() public {
        address newTreasury = makeAddr("newTreasury");
        escrow.setTreasury(newTreasury);
        assertEq(escrow.treasury(), newTreasury);

        vm.prank(sponsor);
        vm.expectRevert();
        escrow.setTreasury(sponsor);
    }

    // ---------- wrong-caller on the fund-EXIT paths (P6 hardening) ----------
    // The fund-moving exits must reject any caller without CONTROLLER_ROLE, so a
    // random account can never drain or skim a pool. AccessControl reverts.

    function test_payout_revertsForNonController() public {
        _fundAndApprove(sponsor, 100e6);
        escrow.depositPrizePool(1, sponsor, 100e6);
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(); // attacker lacks CONTROLLER_ROLE
        escrow.payout(1, attacker, 100e6);
        assertEq(escrow.poolBalance(address(this), 1), 100e6, "pool untouched");
        assertEq(usdc.balanceOf(attacker), 0, "nothing stolen");
    }

    function test_skimPlatformFee_revertsForNonController() public {
        _fundAndApprove(sponsor, 100e6);
        escrow.depositPrizePool(1, sponsor, 100e6);
        vm.prank(makeAddr("attacker"));
        vm.expectRevert();
        escrow.skimPlatformFee(1, 100e6);
    }

    function test_sweepUnclaimed_revertsForNonController() public {
        _fundAndApprove(sponsor, 100e6);
        escrow.depositPrizePool(1, sponsor, 100e6);
        vm.prank(makeAddr("attacker"));
        vm.expectRevert();
        escrow.sweepUnclaimed(1);
    }
}
