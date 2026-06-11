// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import { ChallengeKind, ChallengeStatus, ContestType } from "./types/ArcRunTypes.sol";
import { IAgentRegistry } from "./interfaces/IAgentRegistry.sol";
import { IPrizeEscrow } from "./interfaces/IPrizeEscrow.sol";

/// @title  ChallengeArena
/// @notice Peer-to-peer, USDC-staked challenges, ArcRun's bottom-up loop.
///         Any operator opens a challenge and stakes; others match the
///         stake; the coordinator scores off-chain and posts a winner merkle
///         root; the best agent(s) pull the pot minus a small platform fee.
///         Friends challenging friends (prediction duels, puzzles, ...).
/// @dev    Mirrors ContestEngine's merkle-proof, pull settlement, minus a sponsor.
///         No-stranded-funds guarantee: if a challenge fails to fill (< 2
///         entrants past `joinDeadline`) or the coordinator never resolves it
///         by `resolveDeadline`, it can be cancelled and every entrant pulls
///         their stake back via `refund`. Stakes and pots live in PrizeEscrow,
///         namespaced by challenge id under this contract as controller.
///         See ARCRUN_PLAN.md §4.6.
contract ChallengeArena is AccessControl, ReentrancyGuard, Pausable {
    // ============ Roles ============

    /// @notice Backend coordinator: locks, scores, and resolves challenges.
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");

    // ============ Constants ============

    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Ceiling on the platform fee a challenge can carry (20%).
    uint16 public constant MAX_PLATFORM_FEE_BPS = 2_000;

    /// @notice Highest agent tier (mirrors AgentRegistry.MAX_TIER), used to
    ///         validate a challenge's entry tier gate.
    uint16 public constant MAX_TIER = 4;

    // ============ Immutables ============

    IAgentRegistry public immutable agentRegistry;
    IPrizeEscrow public immutable escrow;

    // ============ Mutable state ============

    /// @notice Platform fee (bps) stamped onto each new challenge at creation.
    uint16 public defaultPlatformFeeBps;

    struct Challenge {
        address creator;
        ChallengeKind kind;
        ChallengeStatus status;
        bool isPrivate; // invite-only via `invite`
        uint16 platformFeeBps; // stamped from defaultPlatformFeeBps at creation
        uint128 stake; // USDC (6 dp) each entrant must post
        uint64 maxEntrants; // >= 2
        uint64 joinDeadline;
        uint64 resolveDeadline;
        bytes32 winnerRoot; // merkle root of (operator, amount) payouts
        // Entry tier gate, appended so existing struct decoders stay valid.
        uint16 minTier; // lowest agent tier allowed (0 = open)
        uint16 maxTier; // highest agent tier allowed (MAX_TIER = open top)
    }

    uint256 private _nextChallengeId = 1;
    mapping(uint256 => Challenge) private _challenges;

    /// @notice challengeId => number of entrants who staked.
    mapping(uint256 => uint64) public entrantCount;
    /// @notice challengeId => operator => has joined (staked).
    mapping(uint256 => mapping(address => bool)) public joined;
    /// @notice challengeId => operator => allowed to join a private challenge.
    mapping(uint256 => mapping(address => bool)) public invited;
    /// @notice challengeId => operator => payout claimed.
    mapping(uint256 => mapping(address => bool)) public payoutClaimed;
    /// @notice challengeId => operator => stake refunded (cancelled challenge).
    mapping(uint256 => mapping(address => bool)) public refunded;

    // ============ Events ============

    event ChallengeCreated(uint256 indexed id, address indexed creator, ChallengeKind kind, uint128 stake);
    event ChallengeInvited(uint256 indexed id, address indexed invitee);
    event ChallengeJoined(uint256 indexed id, address indexed operator, uint256 indexed agentId);
    event ChallengeLocked(uint256 indexed id, uint256 pot, uint64 entrants);
    event ChallengeSettled(uint256 indexed id, bytes32 winnerRoot);
    event ChallengePayoutClaimed(uint256 indexed id, address indexed operator, uint256 amount);
    event ChallengeCancelled(uint256 indexed id);
    event ChallengeRefunded(uint256 indexed id, address indexed operator, uint256 amount);
    event ReputationApplied(uint256 indexed id, uint256 count);
    event PlatformFeeUpdated(uint16 oldBps, uint16 newBps);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroStake();
    error BadEntrantCap();
    error BadDeadlines();
    error FeeTooHigh();
    error InvalidTierGate();
    error TierNotAllowed(uint16 agentTier, uint16 minTier, uint16 maxTier);
    error LengthMismatch();
    error ChallengeDoesNotExist();
    error ChallengeNotOpen();
    error NotCreator();
    error JoinClosed();
    error JoinStillOpen();
    error ChallengeFull();
    error NotInvited();
    error NotAgentOwner();
    error AlreadyJoined();
    error NotEnoughEntrants();
    error NotLocked();
    error ResolveWindowClosed();
    error InvalidRoot();
    error ChallengeNotSettled();
    error AlreadyClaimed();
    error InvalidProof();
    error CannotCancel();
    error NotAuthorized();
    error NotCancelled();
    error NotEntrant();
    error AlreadyRefunded();

    // ============ Constructor ============

    constructor(address admin, address agentRegistryAddr, address escrowAddr, uint16 platformFeeBps_) {
        if (admin == address(0)) revert ZeroAddress();
        if (agentRegistryAddr == address(0)) revert ZeroAddress();
        if (escrowAddr == address(0)) revert ZeroAddress();
        if (platformFeeBps_ > MAX_PLATFORM_FEE_BPS) revert FeeTooHigh();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        agentRegistry = IAgentRegistry(agentRegistryAddr);
        escrow = IPrizeEscrow(escrowAddr);
        defaultPlatformFeeBps = platformFeeBps_;
    }

    // ============ Create / invite ============

    /// @notice Open a new peer challenge. The creator does not auto-join; they
    ///         (and everyone else) stake via `joinChallenge`.
    function createChallenge(
        ChallengeKind kind,
        uint128 stake,
        uint64 maxEntrants,
        uint64 joinDeadline,
        uint64 resolveDeadline,
        bool isPrivate,
        uint16 minTier,
        uint16 maxTier
    ) external whenNotPaused returns (uint256 id) {
        if (stake == 0) revert ZeroStake();
        if (maxEntrants < 2) revert BadEntrantCap();
        // forge-lint: disable-next-line(block-timestamp)
        if (joinDeadline <= block.timestamp) revert BadDeadlines();
        if (resolveDeadline <= joinDeadline) revert BadDeadlines();
        if (maxTier > MAX_TIER || minTier > maxTier) revert InvalidTierGate();

        id = _nextChallengeId++;
        _challenges[id] = Challenge({
            creator: msg.sender,
            kind: kind,
            status: ChallengeStatus.OPEN,
            isPrivate: isPrivate,
            platformFeeBps: defaultPlatformFeeBps,
            stake: stake,
            maxEntrants: maxEntrants,
            joinDeadline: joinDeadline,
            resolveDeadline: resolveDeadline,
            winnerRoot: bytes32(0),
            minTier: minTier,
            maxTier: maxTier
        });

        // The creator is allowed to join their own private challenge. Without
        // this they would be locked out of a private pool they opened, since
        // joinChallenge gates on the invited set.
        if (isPrivate) {
            invited[id][msg.sender] = true;
            emit ChallengeInvited(id, msg.sender);
        }

        emit ChallengeCreated(id, msg.sender, kind, stake);
    }

    /// @notice Allow `invitees` to join a private challenge. Creator only,
    ///         while still OPEN.
    function invite(uint256 id, address[] calldata invitees) external {
        Challenge storage ch = _challenges[id];
        if (ch.creator == address(0)) revert ChallengeDoesNotExist();
        if (msg.sender != ch.creator) revert NotCreator();
        if (ch.status != ChallengeStatus.OPEN) revert ChallengeNotOpen();

        for (uint256 i = 0; i < invitees.length; i++) {
            invited[id][invitees[i]] = true;
            emit ChallengeInvited(id, invitees[i]);
        }
    }

    // ============ Operator path ============

    /// @notice Stake into a challenge with an owned agent. Caller must have
    ///         approved the PrizeEscrow for `stake` USDC.
    function joinChallenge(uint256 id, uint256 agentId) external whenNotPaused nonReentrant {
        Challenge storage ch = _challenges[id];
        if (ch.creator == address(0)) revert ChallengeDoesNotExist();
        if (ch.status != ChallengeStatus.OPEN) revert ChallengeNotOpen();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= ch.joinDeadline) revert JoinClosed();
        if (entrantCount[id] >= ch.maxEntrants) revert ChallengeFull();
        if (ch.isPrivate && !invited[id][msg.sender]) revert NotInvited();
        if (agentRegistry.ownerOfAgent(agentId) != msg.sender) revert NotAgentOwner();
        if (joined[id][msg.sender]) revert AlreadyJoined();

        // Tier gate. Each non-custom kind maps to one agent family; the agent's
        // tier in that family must sit within [minTier, maxTier]. CUSTOM
        // challenges are not tier-gated (no canonical family).
        (ContestType family, bool gated) = _familyOf(ch.kind);
        if (gated) {
            uint16 tier = agentRegistry.getTier(agentId, family);
            if (tier < ch.minTier || tier > ch.maxTier) {
                revert TierNotAllowed(tier, ch.minTier, ch.maxTier);
            }
        }

        joined[id][msg.sender] = true;
        unchecked {
            entrantCount[id] += 1;
        }

        escrow.depositChallengePot(id, msg.sender, ch.stake);

        emit ChallengeJoined(id, msg.sender, agentId);
    }

    /// @notice Lock a challenge once it is full or its join window has closed,
    ///         provided at least 2 entrants staked. Permissionless.
    function lockChallenge(uint256 id) external {
        Challenge storage ch = _challenges[id];
        if (ch.creator == address(0)) revert ChallengeDoesNotExist();
        if (ch.status != ChallengeStatus.OPEN) revert ChallengeNotOpen();

        uint64 n = entrantCount[id];
        bool full = n >= ch.maxEntrants;
        // forge-lint: disable-next-line(block-timestamp)
        bool joinEnded = block.timestamp >= ch.joinDeadline;
        if (!full && !joinEnded) revert JoinStillOpen();
        if (n < 2) revert NotEnoughEntrants();

        ch.status = ChallengeStatus.LOCKED;

        emit ChallengeLocked(id, uint256(ch.stake) * n, n);
    }

    /// @notice Claim a payout with a merkle proof of the `(operator, amount)`
    ///         leaf against the settled challenge's winner root.
    /// @dev    Leaf double-hashed to match OpenZeppelin StandardMerkleTree.
    function claimChallengePayout(uint256 id, uint256 amount, bytes32[] calldata proof)
        external
        whenNotPaused
        nonReentrant
    {
        Challenge storage ch = _challenges[id];
        if (ch.status != ChallengeStatus.SETTLED) revert ChallengeNotSettled();
        if (payoutClaimed[id][msg.sender]) revert AlreadyClaimed();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        if (!MerkleProof.verify(proof, ch.winnerRoot, leaf)) revert InvalidProof();

        payoutClaimed[id][msg.sender] = true;
        escrow.payout(id, msg.sender, amount);

        emit ChallengePayoutClaimed(id, msg.sender, amount);
    }

    /// @notice Pull a stake back from a cancelled challenge.
    function refund(uint256 id) external nonReentrant {
        Challenge storage ch = _challenges[id];
        if (ch.creator == address(0)) revert ChallengeDoesNotExist();
        if (ch.status != ChallengeStatus.CANCELLED) revert NotCancelled();
        if (!joined[id][msg.sender]) revert NotEntrant();
        if (refunded[id][msg.sender]) revert AlreadyRefunded();

        refunded[id][msg.sender] = true;
        escrow.payout(id, msg.sender, ch.stake);

        emit ChallengeRefunded(id, msg.sender, ch.stake);
    }

    // ============ Coordinator path ============

    /// @notice Resolve a locked challenge: post the winner root, skim the
    ///         platform fee, and open the pot for claims. Must land on or before
    ///         `resolveDeadline`; after that the challenge can be cancelled and
    ///         refunded instead.
    function postWinnerRoot(uint256 id, bytes32 root)
        external
        onlyRole(COORDINATOR_ROLE)
        nonReentrant
    {
        Challenge storage ch = _challenges[id];
        if (ch.creator == address(0)) revert ChallengeDoesNotExist();
        if (ch.status != ChallengeStatus.LOCKED) revert NotLocked();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > ch.resolveDeadline) revert ResolveWindowClosed();
        if (root == bytes32(0)) revert InvalidRoot();

        ch.winnerRoot = root;
        ch.status = ChallengeStatus.SETTLED;

        uint256 pot = uint256(ch.stake) * entrantCount[id];
        uint256 fee = (pot * ch.platformFeeBps) / BPS_DENOMINATOR;
        if (fee > 0) escrow.skimPlatformFee(id, fee);

        emit ChallengeSettled(id, root);
    }

    /// @notice Apply in-game reputation deltas for a settled challenge's agents.
    ///         Mirrors ContestEngine.applyReputationDeltas so peer challenges
    ///         move the same AgentRegistry reputation contests do. Requires this
    ///         contract to hold CONTEST_ENGINE_ROLE on AgentRegistry (granted at
    ///         deploy). Separate from the ERC-8004 feedback the validator posts.
    function applyReputationDeltas(
        uint256 id,
        uint256[] calldata agentIds,
        int128[] calldata deltas
    ) external onlyRole(COORDINATOR_ROLE) {
        Challenge storage ch = _challenges[id];
        if (ch.creator == address(0)) revert ChallengeDoesNotExist();
        if (ch.status != ChallengeStatus.SETTLED) revert ChallengeNotSettled();

        uint256 n = agentIds.length;
        if (n != deltas.length) revert LengthMismatch();

        for (uint256 i = 0; i < n; i++) {
            agentRegistry.applyReputationChange(agentIds[i], deltas[i]);
        }

        emit ReputationApplied(id, n);
    }

    // ============ Cancellation ============

    /// @notice Cancel a challenge so entrants can `refund`. While OPEN: the
    ///         creator, an admin, or the coordinator may cancel any time, and
    ///         anyone may cancel a stale under-filled challenge after
    ///         `joinDeadline`. While LOCKED: cancellation is only allowed after
    ///         `resolveDeadline` (i.e. the coordinator failed to resolve in
    ///         time). No early cancel of a live, funded challenge.
    function cancelChallenge(uint256 id) external {
        Challenge storage ch = _challenges[id];
        if (ch.creator == address(0)) revert ChallengeDoesNotExist();

        ChallengeStatus s = ch.status;
        if (s == ChallengeStatus.SETTLED || s == ChallengeStatus.CANCELLED) revert CannotCancel();

        if (s == ChallengeStatus.OPEN) {
            bool privileged = msg.sender == ch.creator || hasRole(DEFAULT_ADMIN_ROLE, msg.sender)
                || hasRole(COORDINATOR_ROLE, msg.sender);
            // forge-lint: disable-next-line(block-timestamp)
            bool staleUnderfilled = block.timestamp > ch.joinDeadline && entrantCount[id] < 2;
            if (!privileged && !staleUnderfilled) revert NotAuthorized();
        } else {
            // LOCKED: timeout cancel only.
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp <= ch.resolveDeadline) revert CannotCancel();
        }

        ch.status = ChallengeStatus.CANCELLED;

        emit ChallengeCancelled(id);
    }

    // ============ Admin ============

    function setDefaultPlatformFeeBps(uint16 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBps > MAX_PLATFORM_FEE_BPS) revert FeeTooHigh();
        emit PlatformFeeUpdated(defaultPlatformFeeBps, newBps);
        defaultPlatformFeeBps = newBps;
    }

    /// @notice Emergency stop: blocks new challenges, joins, and claims. Admin
    ///         only. Lock/resolve/cancel/refund stay open so a paused challenge
    ///         can still be unwound and entrants can recover stakes.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ============ Internals ============

    /// @dev Map a challenge kind to the agent family whose tier gates entry.
    ///      CUSTOM has no canonical family, so it is reported ungated.
    function _familyOf(ChallengeKind kind) internal pure returns (ContestType family, bool gated) {
        if (kind == ChallengeKind.PREDICTION) return (ContestType.ANALYST, true);
        if (kind == ChallengeKind.PUZZLE) return (ContestType.SOLVER, true);
        if (kind == ChallengeKind.VOLUME) return (ContestType.SCOUT, true);
        return (ContestType.SOLVER, false); // CUSTOM: ungated
    }

    // ============ Views ============

    function getChallenge(uint256 id) external view returns (Challenge memory) {
        return _challenges[id];
    }

    function nextChallengeId() external view returns (uint256) {
        return _nextChallengeId;
    }
}
