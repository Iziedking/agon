// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { AgonServiceRegistry } from "./AgonServiceRegistry.sol";

/// @title AgonJobEscrow
/// @notice Custodies USDC for a single asynchronous job and settles it only
///         through the pinned listing, review, and dispute lifecycle.
/// @dev    Direct x402 payments never enter this contract. The contract keeps
///         the provider and listing version snapshots so later registry changes
///         cannot redirect an already funded job.
contract AgonJobEscrow is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant BPS = 10_000;
    uint256 public constant PROTOCOL_FEE_BPS = 500;
    uint64 public constant MAX_REVIEW_HOURS = 720;
    uint64 public constant MIN_REVIEW_HOURS = 1;

    enum Status {
        Created,
        Accepted,
        Submitted,
        Complete,
        Rejected,
        Disputed,
        Failed
    }

    enum Settlement {
        None,
        ProviderPaid,
        BuyerRefunded
    }

    struct Job {
        uint256 jobId;
        address buyer;
        address provider;
        uint256 listingId;
        uint256 agentId;
        uint256 listingVersion;
        bytes32 manifestHash;
        bytes32 termsHash;
        bytes32 deliverableHash;
        uint256 amount;
        uint256 fee;
        uint64 reviewHours;
        uint64 acceptanceDeadline;
        uint64 reviewDeadline;
        uint64 createdAt;
        uint64 submittedAt;
        Status status;
        Settlement settlement;
    }

    IERC20 public immutable usdc;
    AgonServiceRegistry public immutable serviceRegistry;
    address public immutable disputeResolver;
    address public treasury;
    uint64 public immutable defaultReviewHours;

    uint256 private _nextJobId = 1;
    mapping(uint256 => Job) private _jobs;
    mapping(address => mapping(bytes32 => uint256)) public jobByReference;

    event JobCreated(
        uint256 indexed jobId,
        bytes32 indexed clientReference,
        address indexed buyer,
        address provider,
        uint256 listingId,
        uint256 agentId,
        uint256 listingVersion,
        bytes32 manifestHash,
        bytes32 termsHash,
        uint256 amount,
        uint256 fee,
        uint64 reviewHours,
        uint64 acceptanceDeadline
    );
    event JobAccepted(uint256 indexed jobId, address indexed provider);
    event JobSubmitted(uint256 indexed jobId, bytes32 indexed deliverableHash, uint64 reviewDeadline);
    event JobRejected(uint256 indexed jobId, bytes32 indexed reasonHash);
    event JobDisputed(uint256 indexed jobId, address indexed opener, bytes32 indexed reasonHash);
    event JobSettled(
        uint256 indexed jobId, Settlement settlement, address indexed recipient, uint256 amount, uint256 fee
    );
    event JobFailed(uint256 indexed jobId, address indexed caller, Settlement settlement);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroHash();
    error InvalidReviewHours();
    error InvalidReference();
    error ListingNotEscrowEligible();
    error JobMissing();
    error NotBuyer();
    error NotProvider();
    error NotDisputeResolver();
    error InvalidStatus();
    error AcceptanceWindowOpen();
    error AcceptanceWindowClosed();
    error ReviewWindowOpen();
    error ReviewWindowClosed();
    error JobReferenceAlreadyUsed();
    error InvalidListingSnapshot();

    constructor(
        address admin,
        address usdcAddress,
        address serviceRegistryAddress,
        address disputeResolverAddress,
        address treasuryAddress,
        uint64 defaultReviewHours_
    ) {
        if (admin == address(0) || usdcAddress == address(0) || serviceRegistryAddress == address(0)) revert ZeroAddress();
        if (disputeResolverAddress == address(0) || treasuryAddress == address(0)) revert ZeroAddress();
        _validateReviewHours(defaultReviewHours_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        usdc = IERC20(usdcAddress);
        serviceRegistry = AgonServiceRegistry(serviceRegistryAddress);
        disputeResolver = disputeResolverAddress;
        treasury = treasuryAddress;
        defaultReviewHours = defaultReviewHours_;
    }

    /// @notice Create and fund a job against the current verified Escrow listing.
    /// @dev    `clientReference` is buyer-scoped and prevents accidental duplicate
    ///         funding when a client retries the same command.
    function createJob(
        bytes32 clientReference,
        uint256 listingId,
        bytes32 termsHash,
        uint256 amount,
        uint64 reviewHours
    ) external whenNotPaused nonReentrant returns (uint256 jobId) {
        if (clientReference == bytes32(0)) revert InvalidReference();
        if (termsHash == bytes32(0)) revert ZeroHash();
        if (amount == 0) revert ZeroAmount();
        if (reviewHours == 0) reviewHours = defaultReviewHours;
        _validateReviewHours(reviewHours);
        if (jobByReference[msg.sender][clientReference] != 0) revert JobReferenceAlreadyUsed();

        AgonServiceRegistry.Listing memory listing = serviceRegistry.getListing(listingId);
        if (!serviceRegistry.escrowEligible(listingId)) revert ListingNotEscrowEligible();
        if (listing.providerSnapshot == address(0) || listing.manifestHash == bytes32(0) || listing.version == 0) {
            revert InvalidListingSnapshot();
        }

        uint256 fee = (amount * PROTOCOL_FEE_BPS) / BPS;
        uint256 total = amount + fee;
        jobId = _nextJobId++;
        uint64 createdAt = uint64(block.timestamp);
        uint64 acceptanceDeadline = createdAt + uint64(uint256(reviewHours) * 1 hours);
        _jobs[jobId] = Job({
            jobId: jobId,
            buyer: msg.sender,
            provider: listing.providerSnapshot,
            listingId: listingId,
            agentId: listing.agentId,
            listingVersion: listing.version,
            manifestHash: listing.manifestHash,
            termsHash: termsHash,
            deliverableHash: bytes32(0),
            amount: amount,
            fee: fee,
            reviewHours: reviewHours,
            acceptanceDeadline: acceptanceDeadline,
            reviewDeadline: 0,
            createdAt: createdAt,
            submittedAt: 0,
            status: Status.Created,
            settlement: Settlement.None
        });
        jobByReference[msg.sender][clientReference] = jobId;
        usdc.safeTransferFrom(msg.sender, address(this), total);
        _emitJobCreated(jobId, clientReference);
    }

    function acceptJob(uint256 jobId) external whenNotPaused {
        Job storage job = _job(jobId);
        if (msg.sender != job.provider) revert NotProvider();
        if (job.status != Status.Created) revert InvalidStatus();
        if (block.timestamp > job.acceptanceDeadline) revert AcceptanceWindowClosed();
        job.status = Status.Accepted;
        emit JobAccepted(jobId, msg.sender);
    }

    function submitJob(uint256 jobId, bytes32 deliverableHash) external whenNotPaused {
        Job storage job = _job(jobId);
        if (msg.sender != job.provider) revert NotProvider();
        if (job.status != Status.Accepted) revert InvalidStatus();
        if (block.timestamp > job.acceptanceDeadline) revert AcceptanceWindowClosed();
        if (deliverableHash == bytes32(0)) revert ZeroHash();
        job.deliverableHash = deliverableHash;
        job.submittedAt = uint64(block.timestamp);
        job.reviewDeadline = uint64(block.timestamp) + uint64(uint256(job.reviewHours) * 1 hours);
        job.status = Status.Submitted;
        emit JobSubmitted(jobId, deliverableHash, job.reviewDeadline);
    }

    function acceptSubmission(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if (msg.sender != job.buyer) revert NotBuyer();
        if (job.status != Status.Submitted) revert InvalidStatus();
        if (block.timestamp > job.reviewDeadline) revert ReviewWindowClosed();
        _payProvider(job);
    }

    function autoAccept(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != Status.Submitted) revert InvalidStatus();
        if (block.timestamp <= job.reviewDeadline) revert ReviewWindowOpen();
        _payProvider(job);
    }

    function rejectSubmission(uint256 jobId, bytes32 reasonHash) external {
        Job storage job = _job(jobId);
        if (msg.sender != job.buyer) revert NotBuyer();
        if (job.status != Status.Submitted) revert InvalidStatus();
        if (block.timestamp > job.reviewDeadline) revert ReviewWindowClosed();
        if (reasonHash == bytes32(0)) revert ZeroHash();
        job.status = Status.Rejected;
        emit JobRejected(jobId, reasonHash);
    }

    function openDispute(uint256 jobId, bytes32 reasonHash) external {
        Job storage job = _job(jobId);
        if (msg.sender != job.provider && msg.sender != job.buyer) revert NotBuyer();
        if (job.status != Status.Rejected) revert InvalidStatus();
        if (reasonHash == bytes32(0)) revert ZeroHash();
        job.status = Status.Disputed;
        emit JobDisputed(jobId, msg.sender, reasonHash);
    }

    /// @notice Resolve a rejected submission through the configured Phase 1
    ///         multisig authority. Payment and fee/refund are atomic.
    function resolveDispute(uint256 jobId, bool payProvider) external nonReentrant {
        if (msg.sender != disputeResolver) revert NotDisputeResolver();
        Job storage job = _job(jobId);
        if (job.status != Status.Disputed) revert InvalidStatus();
        if (payProvider) {
            _payProvider(job);
        } else {
            _refundBuyer(job);
        }
    }

    /// @notice Refund an unaccepted or unsubmitted job after its acceptance
    ///         window. This remains callable while paused so funds do not lock.
    function failJob(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if (msg.sender != job.buyer) revert NotBuyer();
        if (job.status != Status.Created && job.status != Status.Accepted) revert InvalidStatus();
        if (block.timestamp <= job.acceptanceDeadline) revert AcceptanceWindowOpen();
        _refundBuyer(job);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _job(jobId);
    }

    function escrowedAmount(uint256 jobId) external view returns (uint256) {
        Job memory job = _job(jobId);
        if (job.settlement != Settlement.None) return 0;
        return job.amount + job.fee;
    }

    function _payProvider(Job storage job) private {
        job.status = Status.Complete;
        job.settlement = Settlement.ProviderPaid;
        usdc.safeTransfer(job.provider, job.amount);
        if (job.fee != 0) usdc.safeTransfer(treasury, job.fee);
        emit JobSettled(job.jobId, Settlement.ProviderPaid, job.provider, job.amount, job.fee);
    }

    function _emitJobCreated(uint256 jobId, bytes32 clientReference) private {
        Job storage job = _jobs[jobId];
        emit JobCreated(
            jobId,
            clientReference,
            job.buyer,
            job.provider,
            job.listingId,
            job.agentId,
            job.listingVersion,
            job.manifestHash,
            job.termsHash,
            job.amount,
            job.fee,
            job.reviewHours,
            job.acceptanceDeadline
        );
    }

    function _refundBuyer(Job storage job) private {
        job.status = Status.Failed;
        job.settlement = Settlement.BuyerRefunded;
        uint256 total = job.amount + job.fee;
        usdc.safeTransfer(job.buyer, total);
        emit JobFailed(job.jobId, msg.sender, Settlement.BuyerRefunded);
        emit JobSettled(job.jobId, Settlement.BuyerRefunded, job.buyer, total, 0);
    }

    function _job(uint256 jobId) private view returns (Job storage job) {
        job = _jobs[jobId];
        if (job.jobId == 0) revert JobMissing();
    }

    function _validateReviewHours(uint64 reviewHours) private pure {
        if (reviewHours < MIN_REVIEW_HOURS || reviewHours > MAX_REVIEW_HOURS) revert InvalidReviewHours();
    }
}
