// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";

import { SyndicateFactory } from "../src/SyndicateFactory.sol";

contract SyndicateFactoryTest is Test {
    SyndicateFactory internal factory;

    address internal admin = makeAddr("admin");
    address internal coordinator = makeAddr("coordinator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.startPrank(admin);
        factory = new SyndicateFactory(admin);
        factory.grantRole(factory.COORDINATOR_ROLE(), coordinator);
        vm.stopPrank();
    }

    function test_constructor_seedsFourFoundingSyndicates() public view {
        assertEq(factory.syndicateCount(), 4);
        assertEq(factory.getSyndicate(1).name, "Arc Crimson");
        assertEq(factory.getSyndicate(4).name, "Arc Violet");
        assertEq(factory.getSyndicate(1).founder, address(0));
        assertFalse(factory.getSyndicate(1).isCustom);
    }

    function test_joinSyndicate_setsMembership() public {
        vm.prank(alice);
        factory.joinSyndicate(1);
        assertEq(factory.currentSyndicate(alice), 1);
        assertEq(factory.getSyndicate(1).memberCount, 1);
    }

    function test_switchSyndicate_movesMemberCount() public {
        vm.startPrank(alice);
        factory.joinSyndicate(1);
        factory.joinSyndicate(2); // auto-leaves 1
        vm.stopPrank();

        assertEq(factory.currentSyndicate(alice), 2);
        assertEq(factory.getSyndicate(1).memberCount, 0);
        assertEq(factory.getSyndicate(2).memberCount, 1);
    }

    function test_leaveSyndicate() public {
        vm.startPrank(alice);
        factory.joinSyndicate(1);
        factory.leaveSyndicate();
        vm.stopPrank();
        assertEq(factory.currentSyndicate(alice), 0);
        assertEq(factory.getSyndicate(1).memberCount, 0);
    }

    function test_join_revertsOnUnknownSyndicate() public {
        vm.prank(alice);
        vm.expectRevert(SyndicateFactory.SyndicateDoesNotExist.selector);
        factory.joinSyndicate(99);
    }

    function test_join_revertsWhenAlreadyMember() public {
        vm.startPrank(alice);
        factory.joinSyndicate(1);
        vm.expectRevert(abi.encodeWithSelector(SyndicateFactory.AlreadyInSyndicate.selector, uint256(1)));
        factory.joinSyndicate(1);
        vm.stopPrank();
    }

    function test_recordContribution_accruesToCurrentSyndicate() public {
        vm.prank(alice);
        factory.joinSyndicate(1);

        vm.prank(coordinator);
        factory.recordContribution(alice, 500);

        assertEq(factory.getSyndicate(1).totalReputation, 500);
        assertEq(factory.getMembership(1, alice).contribution, 500);
    }

    function test_recordContribution_revertsIfNotInSyndicate() public {
        vm.prank(coordinator);
        vm.expectRevert(SyndicateFactory.NotInSyndicate.selector);
        factory.recordContribution(bob, 500);
    }

    function test_settleWeeklyWar_incrementsWeek() public {
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        uint256[] memory totals = new uint256[](2);
        totals[0] = 100;
        totals[1] = 80;

        vm.prank(coordinator);
        uint256 weekId = factory.settleWeeklyWar(ids, totals);
        assertEq(weekId, 1);
        assertEq(factory.weekCount(), 1);
    }

    function test_settleWeeklyWar_revertsOnLengthMismatch() public {
        uint256[] memory ids = new uint256[](2);
        uint256[] memory totals = new uint256[](1);
        vm.prank(coordinator);
        vm.expectRevert(SyndicateFactory.LengthMismatch.selector);
        factory.settleWeeklyWar(ids, totals);
    }

    function test_createSyndicate_disabledByDefault() public {
        vm.prank(alice);
        vm.expectRevert(SyndicateFactory.CustomCreationDisabled.selector);
        factory.createSyndicate("Custom", "theme");
    }

    function test_createSyndicate_worksWhenEnabled() public {
        vm.prank(admin);
        factory.setCustomCreationEnabled(true);

        vm.prank(alice);
        uint256 id = factory.createSyndicate("Alice DAO", "builders");
        assertEq(id, 5);
        assertTrue(factory.getSyndicate(id).isCustom);
        assertEq(factory.getSyndicate(id).founder, alice);
    }

    function test_setCustomCreationEnabled_onlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        factory.setCustomCreationEnabled(true);
    }
}
