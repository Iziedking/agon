// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

import { AgonProfileRegistry } from "./AgonProfileRegistry.sol";

/// @title AgonSyndicateRegistry
/// @notice Locks multi-owner agent rosters and records contribution evidence
///         for a campaign. It does not custody prize funds.
contract AgonSyndicateRegistry is AccessControl, Pausable {
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");
    bytes32 public constant EVALUATOR_ROLE = keccak256("EVALUATOR_ROLE");

    enum State {
        Created,
        Recruiting,
        Locked,
        Competing,
        Settled
    }

    struct Syndicate {
        uint256 syndicateId;
        bytes32 nameHash;
        bytes32 campaignHash;
        address creator;
        uint64 createdAt;
        uint64 lockedAt;
        uint64 settledAt;
        uint256 memberCount;
        State state;
    }

    struct Member {
        uint256 agentId;
        address ownerSnapshot;
        uint64 joinedAt;
        uint256 contributionScore;
    }

    uint256 private _nextSyndicateId = 1;
    AgonProfileRegistry public immutable profiles;
    mapping(uint256 => Syndicate) private _syndicates;
    mapping(uint256 => mapping(uint256 => Member)) private _members;
    mapping(uint256 => uint256[]) private _memberAgentIds;
    mapping(uint256 => mapping(bytes32 => bool)) public contributionRecorded;

    event SyndicateCreated(
        uint256 indexed syndicateId, address indexed creator, bytes32 indexed campaignHash, bytes32 nameHash
    );
    event AgentJoined(uint256 indexed syndicateId, uint256 indexed agentId, address indexed ownerSnapshot);
    event RosterLocked(uint256 indexed syndicateId, uint256 memberCount);
    event CompetitionStarted(uint256 indexed syndicateId);
    event ContributionRecorded(
        uint256 indexed syndicateId,
        uint256 indexed agentId,
        bytes32 indexed contributionKey,
        uint256 score,
        bytes32 evidenceHash
    );
    event CampaignSettled(uint256 indexed syndicateId);

    error ZeroAddress();
    error ZeroHash();
    error SyndicateMissing();
    error InvalidState();
    error NotCreator();
    error NotAgentOwner();
    error AgentAlreadyJoined();
    error MemberMissing();
    error ContributionAlreadyRecorded();

    constructor(address admin, address profileRegistry) {
        if (admin == address(0) || profileRegistry == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COORDINATOR_ROLE, admin);
        _grantRole(EVALUATOR_ROLE, admin);
        profiles = AgonProfileRegistry(profileRegistry);
    }

    function createSyndicate(bytes32 nameHash, bytes32 campaignHash)
        external
        whenNotPaused
        returns (uint256 syndicateId)
    {
        if (nameHash == bytes32(0) || campaignHash == bytes32(0)) revert ZeroHash();
        syndicateId = _nextSyndicateId++;
        _syndicates[syndicateId] = Syndicate({
            syndicateId: syndicateId,
            nameHash: nameHash,
            campaignHash: campaignHash,
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            lockedAt: 0,
            settledAt: 0,
            memberCount: 0,
            state: State.Recruiting
        });
        emit SyndicateCreated(syndicateId, msg.sender, campaignHash, nameHash);
    }

    function joinSyndicate(uint256 syndicateId, uint256 agentId) external whenNotPaused {
        Syndicate storage syndicate = _syndicate(syndicateId);
        if (syndicate.state != State.Recruiting) revert InvalidState();
        if (profiles.currentOwner(agentId) != msg.sender) revert NotAgentOwner();
        if (_members[syndicateId][agentId].agentId != 0) revert AgentAlreadyJoined();
        _members[syndicateId][agentId] = Member({
            agentId: agentId, ownerSnapshot: msg.sender, joinedAt: uint64(block.timestamp), contributionScore: 0
        });
        _memberAgentIds[syndicateId].push(agentId);
        syndicate.memberCount++;
        emit AgentJoined(syndicateId, agentId, msg.sender);
    }

    function lockRoster(uint256 syndicateId) external {
        Syndicate storage syndicate = _syndicate(syndicateId);
        if (msg.sender != syndicate.creator && !hasRole(COORDINATOR_ROLE, msg.sender)) revert NotCreator();
        if (syndicate.state != State.Recruiting || syndicate.memberCount == 0) revert InvalidState();
        syndicate.state = State.Locked;
        syndicate.lockedAt = uint64(block.timestamp);
        emit RosterLocked(syndicateId, syndicate.memberCount);
    }

    function startCompetition(uint256 syndicateId) external onlyRole(COORDINATOR_ROLE) {
        Syndicate storage syndicate = _syndicate(syndicateId);
        if (syndicate.state != State.Locked) revert InvalidState();
        syndicate.state = State.Competing;
        emit CompetitionStarted(syndicateId);
    }

    function recordContribution(
        uint256 syndicateId,
        uint256 agentId,
        bytes32 contributionKey,
        uint256 score,
        bytes32 evidenceHash
    ) external onlyRole(EVALUATOR_ROLE) {
        Syndicate storage syndicate = _syndicate(syndicateId);
        if (syndicate.state != State.Competing) revert InvalidState();
        if (contributionKey == bytes32(0) || evidenceHash == bytes32(0)) revert ZeroHash();
        if (contributionRecorded[syndicateId][contributionKey]) revert ContributionAlreadyRecorded();
        Member storage member = _members[syndicateId][agentId];
        if (member.agentId == 0) revert MemberMissing();
        contributionRecorded[syndicateId][contributionKey] = true;
        member.contributionScore += score;
        emit ContributionRecorded(syndicateId, agentId, contributionKey, score, evidenceHash);
    }

    function settleCampaign(uint256 syndicateId) external onlyRole(COORDINATOR_ROLE) {
        Syndicate storage syndicate = _syndicate(syndicateId);
        if (syndicate.state != State.Competing) revert InvalidState();
        syndicate.state = State.Settled;
        syndicate.settledAt = uint64(block.timestamp);
        emit CampaignSettled(syndicateId);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function getSyndicate(uint256 syndicateId) external view returns (Syndicate memory) {
        return _syndicate(syndicateId);
    }

    function getMember(uint256 syndicateId, uint256 agentId) external view returns (Member memory) {
        Member memory member = _members[syndicateId][agentId];
        if (member.agentId == 0) revert MemberMissing();
        return member;
    }

    function getMemberAgentIds(uint256 syndicateId) external view returns (uint256[] memory) {
        _syndicate(syndicateId);
        return _memberAgentIds[syndicateId];
    }

    function _syndicate(uint256 syndicateId) private view returns (Syndicate storage syndicate) {
        syndicate = _syndicates[syndicateId];
        if (syndicate.syndicateId == 0) revert SyndicateMissing();
    }
}
