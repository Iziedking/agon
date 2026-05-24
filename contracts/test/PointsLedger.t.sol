// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";

import { PointsLedger } from "../src/PointsLedger.sol";
import { ContestType } from "../src/types/ArcRunTypes.sol";

contract PointsLedgerTest is Test {
    PointsLedger internal ledger;

    address internal admin = makeAddr("admin");
    address internal coordinator = makeAddr("coordinator");
    address internal engine = makeAddr("engine");
    address internal alice = makeAddr("alice");

    function setUp() public {
        vm.startPrank(admin);
        ledger = new PointsLedger(admin);
        ledger.grantRole(ledger.COORDINATOR_ROLE(), coordinator);
        ledger.grantRole(ledger.CONTEST_ENGINE_ROLE(), engine);
        vm.stopPrank();
    }

    function test_credit_increasesBalanceAndLifetime() public {
        vm.prank(coordinator);
        ledger.credit(alice, 100, 1, ContestType.SCOUT);
        assertEq(ledger.balanceOf(alice), 100);
        assertEq(ledger.lifetimeOf(alice), 100);
    }

    function test_debit_reducesBalanceButNotLifetime() public {
        vm.prank(coordinator);
        ledger.credit(alice, 100, 1, ContestType.SCOUT);
        vm.prank(engine);
        ledger.debit(alice, 40, 1);
        assertEq(ledger.balanceOf(alice), 60);
        assertEq(ledger.lifetimeOf(alice), 100, "lifetime is monotonic");
    }

    function test_debit_revertsOnInsufficientBalance() public {
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(PointsLedger.InsufficientBalance.selector, uint128(0), uint128(1)));
        ledger.debit(alice, 1, 1);
    }

    function test_credit_revertsOnZeroAmountOrAddress() public {
        vm.startPrank(coordinator);
        vm.expectRevert(PointsLedger.ZeroAmount.selector);
        ledger.credit(alice, 0, 1, ContestType.SCOUT);
        vm.expectRevert(PointsLedger.ZeroAddress.selector);
        ledger.credit(address(0), 1, 1, ContestType.SCOUT);
        vm.stopPrank();
    }

    function test_credit_onlyCoordinator() public {
        vm.prank(alice);
        vm.expectRevert();
        ledger.credit(alice, 100, 1, ContestType.SCOUT);
    }

    function test_debit_onlyContestEngine() public {
        vm.prank(coordinator);
        ledger.credit(alice, 100, 1, ContestType.SCOUT);
        vm.prank(coordinator); // coordinator cannot debit
        vm.expectRevert();
        ledger.debit(alice, 10, 1);
    }
}
