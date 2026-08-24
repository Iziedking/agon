// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

import { AgonProfileRegistry } from "./AgonProfileRegistry.sol";
import { AgonServiceRegistry } from "./AgonServiceRegistry.sol";

/// @title AgonArena
/// @notice Records scoped adversarial evaluations and their ERC-8004 validation
///         anchors without holding prize funds or minting agent identities.
contract AgonArena is AccessControl, Pausable {
    bytes32 public constant EVALUATOR_ROLE = keccak256("EVALUATOR_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    uint8 public constant MIN_PASSING_SCORE = 50;

    enum State {
        Pending,
        Active,
        Submitted,
        Verified,
        Rejected,
        Expired,
        Revoked
    }

    struct Evaluation {
        uint256 evaluationId;
        uint256 listingId;
        uint256 agentId;
        uint256 listingVersion;
        uint256 category;
        address participant;
        bytes32 manifestHash;
        bytes32 capabilityHash;
        bytes32 evaluatorVersionHash;
        bytes32 taskCommitment;
        bytes32 evidenceRoot;
        bytes32 validationRequestHash;
        bytes32 validationResponseHash;
        uint8 score;
        uint64 requestedAt;
        uint64 submittedAt;
        uint64 scoredAt;
        uint64 expiresAt;
        State state;
    }

    AgonProfileRegistry public immutable profiles;
    AgonServiceRegistry public immutable services;
    address public immutable validationRegistry;
    uint256 private _nextEvaluationId = 1;
    mapping(uint256 => Evaluation) private _evaluations;
    mapping(bytes32 => uint256) public evaluationByRequestHash;

    event EvaluationRequested(
        uint256 indexed evaluationId,
        bytes32 indexed validationRequestHash,
        uint256 indexed listingId,
        uint256 agentId,
        uint256 listingVersion,
        address participant,
        bytes32 capabilityHash,
        bytes32 evaluatorVersionHash,
        bytes32 taskCommitment,
        uint64 expiresAt
    );
    event EvaluationStarted(uint256 indexed evaluationId, address indexed evaluator);
    event EvidenceSubmitted(uint256 indexed evaluationId, bytes32 indexed evidenceRoot, uint64 submittedAt);
    event EvaluationScored(
        uint256 indexed evaluationId, uint8 score, State state, bytes32 indexed validationResponseHash
    );
    event EvaluationExpired(uint256 indexed evaluationId);
    event EvaluationRevoked(uint256 indexed evaluationId, address indexed actor, bytes32 indexed reasonHash);

    error ZeroAddress();
    error ZeroHash();
    error InvalidScore();
    error InvalidExpiry();
    error ListingNotAvailable();
    error EvaluationMissing();
    error RequestAlreadyUsed();
    error WrongParticipant();
    error InvalidState();
    error EvaluationNotExpired();

    constructor(address admin, address profileRegistry, address serviceRegistry, address validationRegistryAddress) {
        if (
            admin == address(0) || profileRegistry == address(0) || serviceRegistry == address(0)
                || validationRegistryAddress == address(0)
        ) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);
        profiles = AgonProfileRegistry(profileRegistry);
        services = AgonServiceRegistry(serviceRegistry);
        validationRegistry = validationRegistryAddress;
    }

    function requestEvaluation(
        bytes32 validationRequestHash,
        uint256 listingId,
        bytes32 capabilityHash,
        bytes32 evaluatorVersionHash,
        bytes32 taskCommitment,
        uint64 expiresAt
    ) external whenNotPaused returns (uint256 evaluationId) {
        if (
            validationRequestHash == bytes32(0) || capabilityHash == bytes32(0) || evaluatorVersionHash == bytes32(0)
                || taskCommitment == bytes32(0)
        ) revert ZeroHash();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (evaluationByRequestHash[validationRequestHash] != 0) revert RequestAlreadyUsed();
        AgonServiceRegistry.Listing memory listing = services.getListing(listingId);
        if (
            listing.status != AgonServiceRegistry.ListingStatus.Listed || listing.manifestHash == bytes32(0)
                || listing.version == 0
        ) revert ListingNotAvailable();
        address participant = profiles.currentOwner(listing.agentId);
        if (participant == address(0) || participant != msg.sender) revert WrongParticipant();

        evaluationId = _nextEvaluationId++;
        _evaluations[evaluationId] = Evaluation({
            evaluationId: evaluationId,
            listingId: listingId,
            agentId: listing.agentId,
            listingVersion: listing.version,
            category: listing.category,
            participant: participant,
            manifestHash: listing.manifestHash,
            capabilityHash: capabilityHash,
            evaluatorVersionHash: evaluatorVersionHash,
            taskCommitment: taskCommitment,
            evidenceRoot: bytes32(0),
            validationRequestHash: validationRequestHash,
            validationResponseHash: bytes32(0),
            score: 0,
            requestedAt: uint64(block.timestamp),
            submittedAt: 0,
            scoredAt: 0,
            expiresAt: expiresAt,
            state: State.Pending
        });
        evaluationByRequestHash[validationRequestHash] = evaluationId;
        emit EvaluationRequested(
            evaluationId,
            validationRequestHash,
            listingId,
            listing.agentId,
            listing.version,
            participant,
            capabilityHash,
            evaluatorVersionHash,
            taskCommitment,
            expiresAt
        );
    }

    function startEvaluation(uint256 evaluationId) external onlyRole(EVALUATOR_ROLE) whenNotPaused {
        Evaluation storage evaluation = _evaluation(evaluationId);
        if (evaluation.state != State.Pending) revert InvalidState();
        if (block.timestamp >= evaluation.expiresAt) revert InvalidExpiry();
        evaluation.state = State.Active;
        emit EvaluationStarted(evaluationId, msg.sender);
    }

    function submitEvidence(uint256 evaluationId, bytes32 evidenceRoot) external whenNotPaused {
        Evaluation storage evaluation = _evaluation(evaluationId);
        if (msg.sender != evaluation.participant) revert WrongParticipant();
        if (evaluation.state != State.Active) revert InvalidState();
        if (block.timestamp >= evaluation.expiresAt) revert InvalidExpiry();
        if (evidenceRoot == bytes32(0)) revert ZeroHash();
        evaluation.evidenceRoot = evidenceRoot;
        evaluation.submittedAt = uint64(block.timestamp);
        evaluation.state = State.Submitted;
        emit EvidenceSubmitted(evaluationId, evidenceRoot, evaluation.submittedAt);
    }

    function scoreEvaluation(uint256 evaluationId, uint8 score, bytes32 validationResponseHash)
        external
        onlyRole(EVALUATOR_ROLE)
        whenNotPaused
    {
        Evaluation storage evaluation = _evaluation(evaluationId);
        if (evaluation.state != State.Submitted) revert InvalidState();
        if (score > 100 || validationResponseHash == bytes32(0)) revert InvalidScore();
        evaluation.score = score;
        evaluation.validationResponseHash = validationResponseHash;
        evaluation.scoredAt = uint64(block.timestamp);
        evaluation.state = score >= MIN_PASSING_SCORE ? State.Verified : State.Rejected;
        emit EvaluationScored(evaluationId, score, evaluation.state, validationResponseHash);
    }

    function expireEvaluation(uint256 evaluationId) external {
        Evaluation storage evaluation = _evaluation(evaluationId);
        if (
            evaluation.state != State.Pending && evaluation.state != State.Active && evaluation.state != State.Submitted
        ) revert InvalidState();
        if (block.timestamp < evaluation.expiresAt) revert EvaluationNotExpired();
        evaluation.state = State.Expired;
        emit EvaluationExpired(evaluationId);
    }

    function revokeEvaluation(uint256 evaluationId, bytes32 reasonHash) external onlyRole(VERIFIER_ROLE) {
        if (reasonHash == bytes32(0)) revert ZeroHash();
        Evaluation storage evaluation = _evaluation(evaluationId);
        if (evaluation.state != State.Verified && evaluation.state != State.Rejected) revert InvalidState();
        evaluation.state = State.Revoked;
        emit EvaluationRevoked(evaluationId, msg.sender, reasonHash);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function getEvaluation(uint256 evaluationId) external view returns (Evaluation memory) {
        return _evaluation(evaluationId);
    }

    function _evaluation(uint256 evaluationId) private view returns (Evaluation storage evaluation) {
        evaluation = _evaluations[evaluationId];
        if (evaluation.evaluationId == 0) revert EvaluationMissing();
    }
}
