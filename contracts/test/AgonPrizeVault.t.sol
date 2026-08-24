// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";

import { AgonPrizeVault } from "../src/AgonPrizeVault.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";

contract AgonPrizeVaultTest is Test {
    MockUSDC internal usdc;
    AgonPrizeVault internal vault;
    address internal admin = makeAddr("admin");
    address internal sponsor = makeAddr("sponsor");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");
    bytes32 internal constant POOL = keccak256("syndicate-pool-1");
    uint256 internal constant PRINCIPAL = 1000e6;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new AgonPrizeVault(admin, address(usdc), treasury);
        usdc.mint(sponsor, 2000e6);
        vm.prank(sponsor);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _leaf(uint256 index, address beneficiary, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(index, beneficiary, amount))));
    }

    function _root(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(bytes.concat(a, b)) : keccak256(bytes.concat(b, a));
    }

    function _fund() internal {
        vm.prank(admin);
        vault.createPool(POOL, AgonPrizeVault.PoolKind.Syndicate, 7, sponsor, PRINCIPAL, 500);
    }

    function test_fundsPoolCollectsFeeAndPullClaimsConservePrincipal() public {
        _fund();
        bytes32 aliceLeaf = _leaf(0, alice, 600e6);
        bytes32 bobLeaf = _leaf(1, bob, 300e6);
        vm.prank(admin);
        vault.publishPayoutRoot(POOL, _root(aliceLeaf, bobLeaf), 900e6, uint64(block.timestamp + 7 days));

        bytes32[] memory aliceProof = new bytes32[](1);
        aliceProof[0] = bobLeaf;
        vault.claim(POOL, 0, alice, 600e6, aliceProof);
        bytes32[] memory bobProof = new bytes32[](1);
        bobProof[0] = aliceLeaf;
        vault.claim(POOL, 1, bob, 300e6, bobProof);

        assertEq(usdc.balanceOf(alice), 600e6);
        assertEq(usdc.balanceOf(bob), 300e6);
        assertEq(usdc.balanceOf(treasury), 50e6);
        assertEq(vault.getPool(POOL).claimedTotal, 900e6);

        vm.prank(admin);
        vault.refundRemaining(POOL);
        assertEq(usdc.balanceOf(sponsor), 1050e6);
        assertEq(uint8(vault.getPool(POOL).state), uint8(AgonPrizeVault.State.Closed));
    }

    function test_claimRejectsInvalidProofAndReplay() public {
        _fund();
        bytes32 leaf = _leaf(0, alice, 900e6);
        vm.prank(admin);
        vault.publishPayoutRoot(POOL, leaf, 900e6, uint64(block.timestamp + 7 days));
        bytes32[] memory noProof = new bytes32[](0);
        vm.expectRevert(AgonPrizeVault.InvalidProof.selector);
        vault.claim(POOL, 0, bob, 900e6, noProof);
        vault.claim(POOL, 0, alice, 900e6, noProof);
        vm.expectRevert(AgonPrizeVault.AlreadyClaimed.selector);
        vault.claim(POOL, 0, alice, 900e6, noProof);
    }

    function test_rootCannotOverAllocateAndRefundWaitsForDeadline() public {
        _fund();
        vm.prank(admin);
        vm.expectRevert(AgonPrizeVault.PayoutExceedsPrincipal.selector);
        vault.publishPayoutRoot(POOL, keccak256("root"), PRINCIPAL + 1, uint64(block.timestamp + 7 days));
        vm.prank(admin);
        vault.publishPayoutRoot(POOL, keccak256("root"), PRINCIPAL, uint64(block.timestamp + 7 days));
        vm.prank(admin);
        vm.expectRevert(AgonPrizeVault.RefundWindowOpen.selector);
        vault.refundRemaining(POOL);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(admin);
        vault.refundRemaining(POOL);
        assertEq(usdc.balanceOf(sponsor), 1950e6);
    }
}
