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

    uint16 internal constant LISTING_FEE_BPS = 150; // 1.5% of the pool
    uint16 internal constant PLATFORM_FEE_BPS = 500; // 5%
    bytes32 internal constant METRIC_VOLUME = keccak256("VOLUME");

    /// Listing fee charged for a given pool, mirroring the contract math.
    function _listingFee(uint256 prizePool) internal pure returns (uint256) {
        return (prizePool * LISTING_FEE_BPS) / 10_000;
    }

    function setUp() public {
        usdc = new MockUSDC();
        idRegistry = new MockIdentityRegistry();

        vm.startPrank(admin);
        escrow = new PrizeEscrow(admin, address(usdc), treasury);
        registry = new AgentRegistry(admin, address(idRegistry), address(usdc), treasury);
        engine = new ContestEngine(admin, address(registry), address(escrow), LISTING_FEE_BPS, PLATFORM_FEE_BPS);

        escrow.grantRole(escrow.CONTROLLER_ROLE(), address(engine));
        registry.grantRole(registry.CONTEST_ENGINE_ROLE(), address(engine));
        engine.grantRole(engine.COORDINATOR_ROLE(), coordinator);
        vm.stopPrank();
    }

    // ---------- helpers ----------

    function _listContest(uint256 prizePool, uint64 duration) internal returns (uint256 id) {
        return _listContestGated(prizePool, duration, 0, 4);
    }

    function _listContestGated(uint256 prizePool, uint64 duration, uint16 minTier, uint16 maxTier)
        internal
        returns (uint256 id)
    {
        uint256 fee = _listingFee(prizePool);
        usdc.mint(sponsor, prizePool + fee);
        vm.startPrank(sponsor);
        usdc.approve(address(escrow), prizePool + fee);
        id = engine.listContest(
            ContestType.SCOUT, address(0xBEEF), METRIC_VOLUME, prizePool, duration, 5000, 10, minTier, maxTier
        );
        vm.stopPrank();
    }

    /// Upgrade an agent's SCOUT tier to `target` (sequential 0..target).
    function _upgradeScout(address operator, uint256 agentId, uint16 target) internal {
        for (uint16 t = 1; t <= target; t++) {
            uint256 price = registry.upgradePrice(ContestType.SCOUT, t - 1);
            usdc.mint(operator, price);
            vm.startPrank(operator);
            usdc.approve(address(registry), price);
            registry.upgradeAgent(agentId, ContestType.SCOUT, t);
            vm.stopPrank();
        }
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
        assertEq(usdc.balanceOf(treasury), _listingFee(1000e6), "listing fee to treasury");

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
        assertEq(usdc.balanceOf(treasury), _listingFee(1000e6) + 50e6, "treasury after settle");
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

    function test_listingFee_isPercentOfPool() public {
        // Listing fee scales with pool size. At 1.5%, a 2000 USDC pool pays 30.
        uint256 id = _listContest(2000e6, 2 days);
        assertEq(usdc.balanceOf(treasury), 30e6, "1.5% of 2000 USDC = 30");
        assertEq(escrow.poolBalance(address(engine), id), 2000e6, "full pool still escrowed");
    }

    function test_setListingFeeBps_changesFee() public {
        vm.prank(admin);
        engine.setListingFeeBps(300); // 3%
        assertEq(engine.listingFeeBps(), 300);

        // List directly with the 3% fee approved (the _listContest helper bakes
        // in the default rate, so it can't be used after a rate change).
        usdc.mint(sponsor, 1000e6 + 30e6);
        vm.startPrank(sponsor);
        usdc.approve(address(escrow), 1000e6 + 30e6);
        engine.listContest(ContestType.SCOUT, address(0xBEEF), METRIC_VOLUME, 1000e6, 2 days, 5000, 10, 0, 4);
        vm.stopPrank();

        assertEq(usdc.balanceOf(treasury), 30e6, "3% of 1000 USDC = 30");
    }

    function test_setListingFeeBps_revertsAboveCap() public {
        vm.prank(admin);
        vm.expectRevert(ContestEngine.FeeTooHigh.selector);
        engine.setListingFeeBps(1001); // > MAX_LISTING_FEE_BPS (10%)
    }

    function test_setListingFeeBps_onlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.setListingFeeBps(100);
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

    function test_registerEntry_revertsOperatorSecondAgent() public {
        // One operator, two agents: the second agent's entry is rejected so a
        // single operator cannot flood one contest. (Audit M3 / bundle #3.)
        uint256 id = _listContest(1000e6, 1 days);
        _createAgentAndEnter(alice, id);

        vm.prank(alice);
        uint256 agent2 = registry.createAgent("ipfs://a2");
        vm.prank(alice);
        vm.expectRevert(ContestEngine.OperatorAlreadyEntered.selector);
        engine.registerEntry(id, agent2, 0);
    }

    function test_registerEntry_tierGate() public {
        // Contest gated to tiers 2..4. A fresh tier-0 agent is rejected; after
        // upgrading SCOUT to tier 2 the same operator's agent can enter.
        uint256 id = _listContestGated(1000e6, 1 days, 2, 4);

        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ContestEngine.TierNotAllowed.selector, uint16(0), uint16(2), uint16(4)));
        engine.registerEntry(id, agentId, 0);

        _upgradeScout(alice, agentId, 2);
        vm.prank(alice);
        engine.registerEntry(id, agentId, 0);
        assertEq(engine.entryCount(id), 1, "tier-2 agent entered");
    }

    function test_listContest_revertsInvalidTierGate() public {
        usdc.mint(sponsor, 1000e6 + _listingFee(1000e6));
        vm.startPrank(sponsor);
        usdc.approve(address(escrow), 1000e6 + _listingFee(1000e6));
        // maxTier above MAX_TIER (4) is rejected.
        vm.expectRevert(ContestEngine.InvalidTierGate.selector);
        engine.listContest(ContestType.SCOUT, address(0xBEEF), METRIC_VOLUME, 1000e6, 1 days, 5000, 10, 0, 5);
        vm.stopPrank();
    }

    function test_pause_blocksEntry() public {
        uint256 id = _listContest(1000e6, 1 days);
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");

        vm.prank(admin);
        engine.pause();

        vm.prank(alice);
        vm.expectRevert(); // Pausable: EnforcedPause
        engine.registerEntry(id, agentId, 0);

        vm.prank(admin);
        engine.unpause();
        vm.prank(alice);
        engine.registerEntry(id, agentId, 0);
        assertEq(engine.entryCount(id), 1, "entry works after unpause");
    }

    function test_pause_onlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.pause();
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
