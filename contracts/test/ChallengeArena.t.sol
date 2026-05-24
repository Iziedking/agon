// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";

import { ChallengeArena } from "../src/ChallengeArena.sol";
import { PrizeEscrow } from "../src/PrizeEscrow.sol";
import { AgentRegistry } from "../src/AgentRegistry.sol";
import { ChallengeKind, ChallengeStatus } from "../src/types/ArcRunTypes.sol";

import { MockUSDC } from "./mocks/MockUSDC.sol";
import { MockIdentityRegistry } from "./mocks/MockIdentityRegistry.sol";
import { MerkleHelper } from "./utils/MerkleHelper.sol";

contract ChallengeArenaTest is Test {
    ChallengeArena internal arena;
    PrizeEscrow internal escrow;
    AgentRegistry internal registry;
    MockUSDC internal usdc;
    MockIdentityRegistry internal idRegistry;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal coordinator = makeAddr("coordinator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint128 internal constant STAKE = 100e6;
    uint16 internal constant FEE_BPS = 250; // 2.5%

    function setUp() public {
        usdc = new MockUSDC();
        idRegistry = new MockIdentityRegistry();

        vm.startPrank(admin);
        escrow = new PrizeEscrow(admin, address(usdc), treasury);
        registry = new AgentRegistry(admin, address(idRegistry), address(usdc), treasury);
        arena = new ChallengeArena(admin, address(registry), address(escrow), FEE_BPS);

        escrow.grantRole(escrow.CONTROLLER_ROLE(), address(arena));
        arena.grantRole(arena.COORDINATOR_ROLE(), coordinator);
        vm.stopPrank();
    }

    // ---------- helpers ----------

    function _agent(address operator) internal returns (uint256 agentId) {
        vm.prank(operator);
        agentId = registry.createAgent("ipfs://agent");
    }

    function _join(address operator, uint256 id) internal {
        uint256 agentId = _agent(operator);
        usdc.mint(operator, STAKE);
        vm.startPrank(operator);
        usdc.approve(address(escrow), STAKE);
        arena.joinChallenge(id, agentId);
        vm.stopPrank();
    }

    function _create(uint64 maxEntrants, bool isPrivate) internal returns (uint256 id) {
        uint64 joinDeadline = uint64(block.timestamp + 1 days);
        uint64 resolveDeadline = uint64(block.timestamp + 2 days);
        vm.prank(alice);
        id = arena.createChallenge(ChallengeKind.PREDICTION, STAKE, maxEntrants, joinDeadline, resolveDeadline, isPrivate);
    }

    // ---------- lifecycle ----------

    function test_fullLifecycle_duelSingleWinner() public {
        uint256 id = _create(2, false);
        _join(alice, id);
        _join(bob, id);
        assertEq(arena.entrantCount(id), 2);
        assertEq(escrow.poolBalance(address(arena), id), 2 * STAKE, "pot escrowed");

        arena.lockChallenge(id); // full
        assertEq(uint8(arena.getChallenge(id).status), uint8(ChallengeStatus.LOCKED));

        // pot = 200, fee = 2.5% = 5, claimable = 195 to the single winner (alice).
        uint256 winAmt = 195e6;
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = MerkleHelper.leaf(alice, winAmt);
        bytes32 root = MerkleHelper.getRoot(leaves);

        vm.prank(coordinator);
        arena.postWinnerRoot(id, root);
        assertEq(usdc.balanceOf(treasury), 5e6, "fee skimmed");

        bytes32[] memory proof = MerkleHelper.getProof(leaves, 0);
        vm.prank(alice);
        arena.claimChallengePayout(id, winAmt, proof);
        assertEq(usdc.balanceOf(alice), winAmt, "winner paid");
        assertEq(escrow.poolBalance(address(arena), id), 0, "pot drained");
    }

    // ---------- refund safety (audit focus) ----------

    function test_refund_whenUnderSubscribed() public {
        uint256 id = _create(3, false);
        _join(alice, id); // only one entrant

        vm.warp(block.timestamp + 1 days + 1); // past joinDeadline

        // anyone can cancel a stale, under-filled challenge
        arena.cancelChallenge(id);
        assertEq(uint8(arena.getChallenge(id).status), uint8(ChallengeStatus.CANCELLED));

        vm.prank(alice);
        arena.refund(id);
        assertEq(usdc.balanceOf(alice), STAKE, "stake returned");
        assertEq(escrow.poolBalance(address(arena), id), 0);
    }

    function test_cancel_onResolveTimeout_thenRefund() public {
        uint256 id = _create(2, false);
        _join(alice, id);
        _join(bob, id);
        arena.lockChallenge(id);

        // coordinator never resolves; past resolveDeadline anyone can cancel
        vm.warp(block.timestamp + 2 days + 1);
        arena.cancelChallenge(id);

        vm.prank(alice);
        arena.refund(id);
        vm.prank(bob);
        arena.refund(id);
        assertEq(usdc.balanceOf(alice), STAKE);
        assertEq(usdc.balanceOf(bob), STAKE);
    }

    function test_postWinnerRoot_revertsAfterResolveDeadline() public {
        uint256 id = _create(2, false);
        _join(alice, id);
        _join(bob, id);
        arena.lockChallenge(id);

        vm.warp(block.timestamp + 2 days + 1);
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = MerkleHelper.leaf(alice, 195e6);
        vm.prank(coordinator);
        vm.expectRevert(ChallengeArena.ResolveWindowClosed.selector);
        arena.postWinnerRoot(id, MerkleHelper.getRoot(leaves));
    }

    function test_cancel_lockedBeforeResolve_reverts() public {
        uint256 id = _create(2, false);
        _join(alice, id);
        _join(bob, id);
        arena.lockChallenge(id);

        // still within resolve window: cannot cancel a live, funded challenge
        vm.prank(alice);
        vm.expectRevert(ChallengeArena.CannotCancel.selector);
        arena.cancelChallenge(id);
    }

    // ---------- join rules ----------

    function test_lock_revertsBelowTwoEntrants() public {
        uint256 id = _create(3, false);
        _join(alice, id);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(ChallengeArena.NotEnoughEntrants.selector);
        arena.lockChallenge(id);
    }

    function test_join_revertsWhenFull() public {
        uint256 id = _create(2, false);
        _join(alice, id);
        _join(bob, id);

        uint256 carolAgent = _agent(carol);
        usdc.mint(carol, STAKE);
        vm.startPrank(carol);
        usdc.approve(address(escrow), STAKE);
        vm.expectRevert(ChallengeArena.ChallengeFull.selector);
        arena.joinChallenge(id, carolAgent);
        vm.stopPrank();
    }

    function test_join_revertsAfterDeadline() public {
        uint256 id = _create(2, false);
        uint256 agentId = _agent(alice);
        usdc.mint(alice, STAKE);
        vm.warp(block.timestamp + 1 days + 1);
        vm.startPrank(alice);
        usdc.approve(address(escrow), STAKE);
        vm.expectRevert(ChallengeArena.JoinClosed.selector);
        arena.joinChallenge(id, agentId);
        vm.stopPrank();
    }

    function test_join_revertsForNonOwnedAgent() public {
        uint256 id = _create(2, false);
        uint256 aliceAgent = _agent(alice);
        usdc.mint(bob, STAKE);
        vm.startPrank(bob);
        usdc.approve(address(escrow), STAKE);
        vm.expectRevert(ChallengeArena.NotAgentOwner.selector);
        arena.joinChallenge(id, aliceAgent);
        vm.stopPrank();
    }

    // ---------- private ----------

    function test_private_requiresInvite() public {
        uint256 id = _create(2, true);

        uint256 bobAgent = _agent(bob);
        usdc.mint(bob, STAKE);
        vm.startPrank(bob);
        usdc.approve(address(escrow), STAKE);
        vm.expectRevert(ChallengeArena.NotInvited.selector);
        arena.joinChallenge(id, bobAgent);
        vm.stopPrank();

        address[] memory invitees = new address[](1);
        invitees[0] = bob;
        vm.prank(alice);
        arena.invite(id, invitees);

        vm.startPrank(bob);
        arena.joinChallenge(id, bobAgent);
        vm.stopPrank();
        assertTrue(arena.joined(id, bob));
    }
}
