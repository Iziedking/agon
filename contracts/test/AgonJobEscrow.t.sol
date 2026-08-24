// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistry } from "../src/AgonServiceRegistry.sol";
import { AgonJobEscrow } from "../src/AgonJobEscrow.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";

contract AgonJobIdentity is ERC721 {
    constructor() ERC721("External Agent", "AGENT") { }

    function mint(address owner, uint256 id) external {
        _mint(owner, id);
    }
}

contract AgonJobEscrowTest is Test {
    AgonJobIdentity internal identity;
    AgonProfileRegistry internal profiles;
    AgonServiceRegistry internal services;
    AgonJobEscrow internal escrow;
    MockUSDC internal usdc;

    address internal admin = makeAddr("admin");
    address internal buyer = makeAddr("buyer");
    address internal provider = makeAddr("provider");
    address internal resolver = makeAddr("resolver");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
    uint256 internal constant AMOUNT = 100e6;
    uint16 internal constant FEE_BPS = 250;
    bytes32 internal constant CLIENT_REFERENCE = keccak256("client-reference-1");
    bytes32 internal constant TERMS_HASH = keccak256("terms-v1");
    bytes32 internal constant DELIVERABLE_HASH = keccak256("deliverable-v1");

    function setUp() public {
        identity = new AgonJobIdentity();
        profiles = new AgonProfileRegistry(admin, address(identity));
        services = new AgonServiceRegistry(admin, address(profiles));
        usdc = new MockUSDC();
        escrow = new AgonJobEscrow(admin, address(usdc), address(services), resolver, treasury, 35);

        identity.mint(provider, 42);
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://profile");
        vm.prank(provider);
        services.publish(
            42,
            keccak256("secure-review"),
            keccak256("manifest-v1"),
            "ipfs://manifest-v1",
            1,
            AgonServiceRegistry.PaymentRail.Escrow
        );
        vm.startPrank(admin);
        services.grantRole(services.VERIFIER_ROLE(), admin);
        services.setVerification(1, AgonServiceRegistry.Verification.Verified);
        vm.stopPrank();

        usdc.mint(buyer, 1000e6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _create() internal returns (uint256 jobId) {
        vm.prank(buyer);
        return escrow.createJob(CLIENT_REFERENCE, 1, TERMS_HASH, AMOUNT, FEE_BPS, 0);
    }

    function test_createPinsListingAndFundsExactly() public {
        uint256 beforeBalance = usdc.balanceOf(buyer);
        uint256 jobId = _create();
        AgonJobEscrow.Job memory job = escrow.getJob(jobId);

        assertEq(job.buyer, buyer);
        assertEq(job.provider, provider);
        assertEq(job.listingId, 1);
        assertEq(job.agentId, 42);
        assertEq(job.listingVersion, 1);
        assertEq(job.manifestHash, keccak256("manifest-v1"));
        assertEq(job.termsHash, TERMS_HASH);
        assertEq(job.amount, AMOUNT);
        assertEq(job.fee, (AMOUNT * FEE_BPS) / 10_000);
        assertEq(uint8(job.status), uint8(AgonJobEscrow.Status.Created));
        assertEq(usdc.balanceOf(buyer), beforeBalance - AMOUNT - job.fee);
        assertEq(escrow.escrowedAmount(jobId), AMOUNT + job.fee);
    }

    function test_create_rejectsUnverifiedListing() public {
        vm.prank(provider);
        services.publish(
            42,
            keccak256("another-service"),
            keccak256("manifest-v2"),
            "ipfs://manifest-v2",
            1,
            AgonServiceRegistry.PaymentRail.Escrow
        );
        vm.prank(buyer);
        vm.expectRevert(AgonJobEscrow.ListingNotEscrowEligible.selector);
        escrow.createJob(keccak256("client-reference-2"), 2, TERMS_HASH, AMOUNT, FEE_BPS, 35);
    }

    function test_create_rejectsDuplicateClientReference() public {
        _create();
        vm.prank(buyer);
        vm.expectRevert(AgonJobEscrow.JobReferenceAlreadyUsed.selector);
        escrow.createJob(CLIENT_REFERENCE, 1, TERMS_HASH, AMOUNT, FEE_BPS, 35);
    }

    function test_acceptSubmitAndBuyerAccept_atomicallyPaysProviderAndTreasury() public {
        uint256 jobId = _create();
        vm.prank(provider);
        escrow.acceptJob(jobId);
        vm.prank(provider);
        escrow.submitJob(jobId, DELIVERABLE_HASH);

        vm.prank(buyer);
        escrow.acceptSubmission(jobId);

        AgonJobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgonJobEscrow.Status.Complete));
        assertEq(uint8(job.settlement), uint8(AgonJobEscrow.Settlement.ProviderPaid));
        assertEq(usdc.balanceOf(provider), AMOUNT);
        assertEq(usdc.balanceOf(treasury), job.fee);
        assertEq(escrow.escrowedAmount(jobId), 0);
    }

    function test_autoAccept_requiresReviewDeadline() public {
        uint256 jobId = _create();
        vm.prank(provider);
        escrow.acceptJob(jobId);
        vm.prank(provider);
        escrow.submitJob(jobId, DELIVERABLE_HASH);

        vm.expectRevert(AgonJobEscrow.ReviewWindowOpen.selector);
        escrow.autoAccept(jobId);
        vm.warp(block.timestamp + 35 hours + 1);
        escrow.autoAccept(jobId);
        assertEq(uint8(escrow.getJob(jobId).settlement), uint8(AgonJobEscrow.Settlement.ProviderPaid));
    }

    function test_rejectedSubmission_requiresResolverForTerminalDecision() public {
        uint256 jobId = _create();
        vm.prank(provider);
        escrow.acceptJob(jobId);
        vm.prank(provider);
        escrow.submitJob(jobId, DELIVERABLE_HASH);
        vm.prank(buyer);
        escrow.rejectSubmission(jobId, keccak256("criteria-failed"));
        vm.prank(provider);
        escrow.openDispute(jobId, keccak256("dispute"));

        vm.prank(stranger);
        vm.expectRevert(AgonJobEscrow.NotDisputeResolver.selector);
        escrow.resolveDispute(jobId, false);

        vm.prank(resolver);
        escrow.resolveDispute(jobId, false);
        AgonJobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgonJobEscrow.Status.Failed));
        assertEq(uint8(job.settlement), uint8(AgonJobEscrow.Settlement.BuyerRefunded));
        assertEq(usdc.balanceOf(buyer), 1000e6);
    }

    function test_failJob_refundsOnlyAfterAcceptanceWindow() public {
        uint256 jobId = _create();
        vm.prank(buyer);
        vm.expectRevert(AgonJobEscrow.AcceptanceWindowOpen.selector);
        escrow.failJob(jobId);

        vm.warp(block.timestamp + 35 hours + 1);
        vm.prank(buyer);
        escrow.failJob(jobId);
        AgonJobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgonJobEscrow.Status.Failed));
        assertEq(uint8(job.settlement), uint8(AgonJobEscrow.Settlement.BuyerRefunded));
        assertEq(usdc.balanceOf(buyer), 1000e6);
    }

    function test_providerCannotAcceptAfterAcceptanceWindow() public {
        uint256 jobId = _create();
        vm.warp(block.timestamp + 35 hours + 1);
        vm.prank(provider);
        vm.expectRevert(AgonJobEscrow.AcceptanceWindowClosed.selector);
        escrow.acceptJob(jobId);
    }

    function test_listingChangesDoNotRedirectExistingJob() public {
        uint256 jobId = _create();
        bytes32 newManifest = keccak256("manifest-v2");
        vm.prank(provider);
        services.publishVersion(1, newManifest, "ipfs://manifest-v2", AgonServiceRegistry.PaymentRail.Escrow);

        AgonJobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.listingVersion, 1);
        assertEq(job.manifestHash, keccak256("manifest-v1"));
        assertEq(job.provider, provider);
    }

    function test_pause_blocksNewJobsButDoesNotLockMatureRefund() public {
        uint256 jobId = _create();
        vm.prank(admin);
        escrow.pause();

        vm.prank(buyer);
        vm.expectRevert();
        escrow.createJob(keccak256("paused-reference"), 1, TERMS_HASH, AMOUNT, FEE_BPS, 35);

        vm.warp(block.timestamp + 35 hours + 1);
        vm.prank(buyer);
        escrow.failJob(jobId);
        assertEq(uint8(escrow.getJob(jobId).settlement), uint8(AgonJobEscrow.Settlement.BuyerRefunded));
    }
}
