// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";

import { ContestEngine } from "../src/ContestEngine.sol";
import { PrizeEscrow } from "../src/PrizeEscrow.sol";
import { AgentRegistry } from "../src/AgentRegistry.sol";
import { ContestType, ContestStatus } from "../src/types/ArcRunTypes.sol";

import { MockUSDC } from "./mocks/MockUSDC.sol";
import { MockIdentityRegistry } from "./mocks/MockIdentityRegistry.sol";
import { MerkleHelper } from "./utils/MerkleHelper.sol";

contract ContestEngineTest is Test {
    ContestEngine internal engine;
    PrizeEscrow internal escrow;
    AgentRegistry internal registry;
    MockUSDC internal usdc;
    MockIdentityRegistry internal idRegistry;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal coordinator = makeAddr("coordinator");
    address internal sponsor = makeAddr("sponsor");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant LISTING_FEE = 5e6; // 5 USDC
    uint16 internal constant PLATFORM_FEE_BPS = 500; // 5%
    bytes32 internal constant METRIC_VOLUME = keccak256("VOLUME");

    function setUp() public {
        usdc = new MockUSDC();
        idRegistry = new MockIdentityRegistry();

        vm.startPrank(admin);
        escrow = new PrizeEscrow(admin, address(usdc), treasury);
        registry = new AgentRegistry(admin, address(idRegistry), address(usdc), treasury);
        engine = new ContestEngine(admin, address(registry), address(escrow), LISTING_FEE, PLATFORM_FEE_BPS);

        escrow.grantRole(escrow.CONTROLLER_ROLE(), address(engine));
        registry.grantRole(registry.CONTEST_ENGINE_ROLE(), address(engine));
        engine.grantRole(engine.COORDINATOR_ROLE(), coordinator);
        vm.stopPrank();
    }

    // ---------- helpers ----------

    function _listContest(uint256 prizePool, uint64 duration) internal returns (uint256 id) {
        usdc.mint(sponsor, prizePool + LISTING_FEE);
        vm.startPrank(sponsor);
        usdc.approve(address(escrow), prizePool + LISTING_FEE);
        id = engine.listContest(ContestType.SCOUT, address(0xBEEF), METRIC_VOLUME, prizePool, duration, 5000, 10);
        vm.stopPrank();
    }

    function _createAgentAndEnter(address operator, uint256 contestId) internal returns (uint256 agentId) {
        vm.prank(operator);
        agentId = registry.createAgent("ipfs://agent");
        vm.prank(operator);
        engine.registerEntry(contestId, agentId, 0);
    }

    // ---------- lifecycle ----------

    function test_listContest_escrowsPoolAndCollectsListingFee() public {
        uint256 id = _listContest(1000e6, 2 days);

        assertEq(id, 1);
        assertEq(escrow.poolBalance(address(engine), id), 1000e6, "pool escrowed");
        assertEq(usdc.balanceOf(treasury), LISTING_FEE, "listing fee to treasury");

        ContestEngine.Contest memory c = engine.getContest(id);
        assertEq(uint8(c.status), uint8(ContestStatus.OPEN));
        assertEq(c.sponsor, sponsor);
        assertEq(c.platformFeeBps, PLATFORM_FEE_BPS, "fee is the admin default");
    }

    function test_fullLifecycle_twoWinnersClaim() public {
        uint256 prizePool = 1000e6;
        uint256 id = _listContest(prizePool, 2 days);

        _createAgentAndEnter(alice, id);
        _createAgentAndEnter(bob, id);
        assertEq(engine.entryCount(id), 2);

        // platform fee = 5% of 1000 = 50; claimable pool = 950, split 600 / 350.
        uint256 aliceAmt = 600e6;
        uint256 bobAmt = 350e6;

        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = MerkleHelper.leaf(alice, aliceAmt);
        leaves[1] = MerkleHelper.leaf(bob, bobAmt);
        bytes32 root = MerkleHelper.getRoot(leaves);

        vm.warp(block.timestamp + 2 days);

        vm.prank(coordinator);
        engine.postScoreRoot(id, root);

        vm.prank(coordinator);
        engine.settle(id);

        // fee skimmed at settle: treasury holds listing fee + platform fee.
        assertEq(usdc.balanceOf(treasury), LISTING_FEE + 50e6, "treasury after settle");
        assertEq(escrow.poolBalance(address(engine), id), 950e6, "pool after skim");

        bytes32[] memory proofA = MerkleHelper.getProof(leaves, 0);
        vm.prank(alice);
        engine.claimPrize(id, aliceAmt, proofA);
        assertEq(usdc.balanceOf(alice), aliceAmt, "alice paid");

        bytes32[] memory proofB = MerkleHelper.getProof(leaves, 1);
        vm.prank(bob);
        engine.claimPrize(id, bobAmt, proofB);
        assertEq(usdc.balanceOf(bob), bobAmt, "bob paid");

        assertEq(escrow.poolBalance(address(engine), id), 0, "pool drained");
    }

    // ---------- access control and audit fix ----------

    function test_listContest_usesAdminFeeNotSponsorChoice() public {
        // The sponsor has no fee parameter; the stored fee is always the admin
        // default. Admin can change it for future contests.
        vm.prank(admin);
        engine.setDefaultPlatformFeeBps(1000);

        uint256 id = _listContest(1000e6, 2 days);
        assertEq(engine.getContest(id).platformFeeBps, 1000, "new admin fee applied");
    }

    function test_setDefaultPlatformFeeBps_revertsAboveCap() public {
        vm.prank(admin);
        vm.expectRevert(ContestEngine.FeeTooHigh.selector);
        engine.setDefaultPlatformFeeBps(2001);
    }

    function test_postScoreRoot_onlyCoordinator() public {
        uint256 id = _listContest(1000e6, 1 days);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert();
        engine.postScoreRoot(id, keccak256("x"));
    }

    // ---------- entry rules ----------

    function test_registerEntry_revertsForNonOwner() public {
        uint256 id = _listContest(1000e6, 1 days);
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");

        vm.prank(bob);
        vm.expectRevert(ContestEngine.NotAgentOwner.selector);
        engine.registerEntry(id, agentId, 0);
    }

    function test_registerEntry_revertsAfterEnd() public {
        uint256 id = _listContest(1000e6, 1 days);
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(ContestEngine.ContestEnded.selector);
        engine.registerEntry(id, agentId, 0);
    }

    function test_registerEntry_revertsDoubleEntry() public {
        uint256 id = _listContest(1000e6, 1 days);
        uint256 agentId = _createAgentAndEnter(alice, id);
        vm.prank(alice);
        vm.expectRevert(ContestEngine.AlreadyEntered.selector);
        engine.registerEntry(id, agentId, 0);
    }

    // ---------- claims ----------

    function test_claimPrize_revertsWithBadProof() public {
        uint256 id = _listContest(1000e6, 1 days);
        _createAgentAndEnter(alice, id);

        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = MerkleHelper.leaf(alice, 600e6);
        leaves[1] = MerkleHelper.leaf(bob, 350e6);
        bytes32 root = MerkleHelper.getRoot(leaves);

        vm.warp(block.timestamp + 1 days);
        vm.prank(coordinator);
        engine.postScoreRoot(id, root);
        vm.prank(coordinator);
        engine.settle(id);

        // Alice claims a wrong amount: proof will not verify.
        bytes32[] memory proofA = MerkleHelper.getProof(leaves, 0);
        vm.prank(alice);
        vm.expectRevert(ContestEngine.InvalidProof.selector);
        engine.claimPrize(id, 999e6, proofA);
    }

    function test_claimPrize_revertsDoubleClaim() public {
        uint256 id = _listContest(1000e6, 1 days);
        _createAgentAndEnter(alice, id);

        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = MerkleHelper.leaf(alice, 600e6);
        leaves[1] = MerkleHelper.leaf(bob, 350e6);
        bytes32 root = MerkleHelper.getRoot(leaves);

        vm.warp(block.timestamp + 1 days);
        vm.prank(coordinator);
        engine.postScoreRoot(id, root);
        vm.prank(coordinator);
        engine.settle(id);

        bytes32[] memory proofA = MerkleHelper.getProof(leaves, 0);
        vm.prank(alice);
        engine.claimPrize(id, 600e6, proofA);

        vm.prank(alice);
        vm.expectRevert(ContestEngine.AlreadyClaimed.selector);
        engine.claimPrize(id, 600e6, proofA);
    }

    // ---------- cancel ----------

    function test_cancelContest_refundsSponsor() public {
        uint256 prizePool = 1000e6;
        uint256 id = _listContest(prizePool, 1 days);

        vm.prank(coordinator);
        engine.cancelContest(id);

        assertEq(uint8(engine.getContest(id).status), uint8(ContestStatus.CANCELLED));
        assertEq(usdc.balanceOf(sponsor), prizePool, "full pool refunded to sponsor");
        assertEq(escrow.poolBalance(address(engine), id), 0, "pool emptied");
    }

    // ---------- sweep ----------

    function test_sweepUnclaimed_afterWindow() public {
        uint256 id = _listContest(1000e6, 1 days);
        _createAgentAndEnter(alice, id);

        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = MerkleHelper.leaf(alice, 600e6);
        leaves[1] = MerkleHelper.leaf(bob, 350e6);
        bytes32 root = MerkleHelper.getRoot(leaves);

        vm.warp(block.timestamp + 1 days);
        vm.prank(coordinator);
        engine.postScoreRoot(id, root);
        vm.prank(coordinator);
        engine.settle(id);

        // Before the window closes, sweeping reverts.
        vm.expectRevert(ContestEngine.ClaimWindowOpen.selector);
        engine.sweepUnclaimed(id);

        vm.warp(block.timestamp + 30 days + 1);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        engine.sweepUnclaimed(id);
        assertEq(usdc.balanceOf(treasury), treasuryBefore + 950e6, "unclaimed swept to treasury");
    }
}
