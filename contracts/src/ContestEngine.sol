// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import { ContestType, ContestStatus } from "./types/ArcRunTypes.sol";
import { IAgentRegistry } from "./interfaces/IAgentRegistry.sol";
import { IPrizeEscrow } from "./interfaces/IPrizeEscrow.sol";

/// @title  ContestEngine
/// @notice Lifecycle for sponsor-hosted contests, ArcRun's Galxe-style B2B
///         engine. A project (`sponsor`) lists and funds a contest with its own
///         USDC, agents enter, the coordinator scores off-chain against a
///         protocol-native `metric` (volume / PnL / activity inside
///         `protocolTarget`), posts a merkle root of `(operator, amount)`
///         payouts, and winners pull their share.
/// @dev    Settlement is merkle-proof, pull-based: no on-chain iteration over
///         entrants, no failing batch tx. Tiered distribution (top-N share a
///         cut, the rest split the remainder) is computed off-chain and encoded
///         in the leaves; `winnerCutBps`/`topN` are stored only as the
///         sponsor's published, auditable terms. USDC custody and per-pool
///         accounting live in PrizeEscrow; this contract only orchestrates.
///         See ARCRUN_PLAN.md §4.1.
contract ContestEngine is AccessControl, ReentrancyGuard, Pausable {
    // ============ Roles ============

    /// @notice Backend coordinator: posts score roots, settles, drives reputation.
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");

    // ============ Constants ============

    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Highest agent tier (mirrors AgentRegistry.MAX_TIER). Used to
    ///         validate a contest's entry tier gate.
    uint16 public constant MAX_TIER = 4;

    /// @notice Ceiling on the platform fee a contest can carry (20%).
    uint16 public constant MAX_PLATFORM_FEE_BPS = 2000;

    /// @notice Ceiling on the listing fee (10% of the prize pool).
    uint16 public constant MAX_LISTING_FEE_BPS = 1000;

    /// @notice Window after a contest ends during which winners can claim.
    ///         After it elapses, leftover pool funds can be swept to treasury.
    uint256 public constant CLAIM_WINDOW = 30 days;

    // ============ Immutables ============

    IAgentRegistry public immutable agentRegistry;
    IPrizeEscrow public immutable escrow;

    // ============ Mutable state ============

    /// @notice Listing fee in bps of the prize pool, paid up front to list a
    ///         contest (separate from the settlement platform-fee skim). 0 =
    ///         free hosting. Charged on the pool size so big campaigns pay more.
    uint16 public listingFeeBps;

    /// @notice ArcRun platform fee (bps) stamped onto each contest at listing.
    ///         Set by the admin, never by the sponsor, so a sponsor cannot zero
    ///         out ArcRun's settlement skim.
    uint16 public defaultPlatformFeeBps;

    struct Contest {
        ContestType contestType; // family; specific objective lives in `metric`
        ContestStatus status;
        uint16 winnerCutBps; // published terms: pool share to the headline tier
        uint16 topN; // published terms: number of headline winners
        uint16 platformFeeBps; // ArcRun cut skimmed at settlement
        address sponsor; // funds the pool and pays the listing fee
        address protocolTarget; // protocol agents must act in; 0 if off-protocol
        bytes32 metric; // keccak256("VOLUME"/"PNL"/"BRIER"/"PUZZLE"/...)
        uint64 startTime;
        uint64 endTime;
        uint256 prizePool; // USDC (6 dp), escrowed at listing
        bytes32 finalRoot; // merkle root of (operator, amount) payouts
        // Entry tier gate, appended so existing struct decoders stay valid.
        uint16 minTier; // lowest agent tier allowed (0 = open)
        uint16 maxTier; // highest agent tier allowed (MAX_TIER = open top)
    }

    uint256 private _nextContestId = 1;
    mapping(uint256 => Contest) private _contests;

    /// @notice contestId => agentId => entered (prevents the same agent twice).
    mapping(uint256 => mapping(uint256 => bool)) public agentEntered;
    /// @notice contestId => operator => entered (one entry per operator: no
    ///         Sybil flooding a pool with many owned agents).
    mapping(uint256 => mapping(address => bool)) public operatorEntered;
    /// @notice contestId => operator => prize claimed.
    mapping(uint256 => mapping(address => bool)) public prizeClaimed;
    /// @notice contestId => number of registered entries.
    mapping(uint256 => uint64) public entryCount;

    // ============ Events ============

    event ContestListed(
        uint256 indexed id,
        address indexed sponsor,
        ContestType indexed cType,
        address protocolTarget,
        uint256 prizePool
    );
    event EntryRegistered(
        uint256 indexed contestId, address indexed operator, uint256 indexed agentId, uint256 syndicateId
    );
    event ContestScored(uint256 indexed contestId, bytes32 scoreRoot);
    event ContestSettled(uint256 indexed contestId, uint256 paidOut, uint256 platformFee);
    event PrizeClaimed(uint256 indexed contestId, address indexed operator, uint256 amount);
    event ReputationApplied(uint256 indexed contestId, uint256 count);
    event ContestCancelled(uint256 indexed contestId, uint256 refunded);
    event UnclaimedSwept(uint256 indexed contestId);
    event ListingFeeUpdated(uint16 oldBps, uint16 newBps);
    event PlatformFeeUpdated(uint16 oldBps, uint16 newBps);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroPrizePool();
    error ZeroDuration();
    error InvalidMetric();
    error InvalidBps();
    error InvalidTopN();
    error FeeTooHigh();
    error ContestDoesNotExist();
    error ContestNotOpen();
    error ContestEnded();
    error ContestNotEnded();
    error NotAgentOwner();
    error AlreadyEntered();
    error OperatorAlreadyEntered();
    error InvalidTierGate();
    error TierNotAllowed(uint16 agentTier, uint16 minTier, uint16 maxTier);
    error InvalidRoot();
    error ContestNotScoring();
    error ContestNotSettled();
    error AlreadyClaimed();
    error InvalidProof();
    error LengthMismatch();
    error NotAuthorized();
    error CannotCancel();
    error ClaimWindowOpen();

    // ============ Constructor ============

    constructor(
        address admin,
        address agentRegistryAddr,
        address escrowAddr,
        uint16 listingFeeBps_,
        uint16 platformFeeBps_
    ) {
        if (admin == address(0)) revert ZeroAddress();
        if (agentRegistryAddr == address(0)) revert ZeroAddress();
        if (escrowAddr == address(0)) revert ZeroAddress();
        if (platformFeeBps_ > MAX_PLATFORM_FEE_BPS) revert FeeTooHigh();
        if (listingFeeBps_ > MAX_LISTING_FEE_BPS) revert FeeTooHigh();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        agentRegistry = IAgentRegistry(agentRegistryAddr);
        escrow = IPrizeEscrow(escrowAddr);
        listingFeeBps = listingFeeBps_;
        defaultPlatformFeeBps = platformFeeBps_;
    }

    // ============ Sponsor path ============

    /// @notice List and fund a sponsor contest in one tx. The caller is the
    ///         sponsor and must have approved the PrizeEscrow for
    ///         the prize pool plus the listing fee. Self-funded bootstrap contests are
    ///         listed by the platform wallet.
    /// @param  cType         Contest family.
    /// @param  protocolTarget Protocol agents must interact with (0 if off-protocol).
    /// @param  metric        Scoring objective id, e.g. keccak256("VOLUME").
    /// @param  prizePool     Total USDC (6 dp) put up for winners, escrowed now.
    /// @param  duration      Seconds the contest stays open for entries/scoring.
    /// @param  winnerCutBps  Published share of the pool to the headline tier.
    /// @param  topN          Published headline winner count.
    /// @param  minTier       Lowest agent tier allowed to enter (0 = open).
    /// @param  maxTier       Highest agent tier allowed (MAX_TIER = open top).
    /// @dev    The platform fee is not a parameter; the admin-set
    ///         `defaultPlatformFeeBps` is stamped onto the contest so a sponsor
    ///         cannot avoid ArcRun's skim. A fully open contest passes
    ///         (minTier=0, maxTier=MAX_TIER).
    function listContest(
        ContestType cType,
        address protocolTarget,
        bytes32 metric,
        uint256 prizePool,
        uint64 duration,
        uint16 winnerCutBps,
        uint16 topN,
        uint16 minTier,
        uint16 maxTier
    ) external whenNotPaused nonReentrant returns (uint256 contestId) {
        if (prizePool == 0) revert ZeroPrizePool();
        if (duration == 0) revert ZeroDuration();
        if (metric == bytes32(0)) revert InvalidMetric();
        if (winnerCutBps > BPS_DENOMINATOR) revert InvalidBps();
        if (topN == 0) revert InvalidTopN();
        if (maxTier > MAX_TIER || minTier > maxTier) revert InvalidTierGate();

        contestId = _nextContestId++;
        uint64 nowTs = uint64(block.timestamp);

        _contests[contestId] = Contest({
            contestType: cType,
            status: ContestStatus.OPEN,
            winnerCutBps: winnerCutBps,
            topN: topN,
            platformFeeBps: defaultPlatformFeeBps,
            sponsor: msg.sender,
            protocolTarget: protocolTarget,
            metric: metric,
            startTime: nowTs,
            endTime: nowTs + duration,
            prizePool: prizePool,
            finalRoot: bytes32(0),
            minTier: minTier,
            maxTier: maxTier
        });

        // Effects set above; now interactions (CEI ordering, guarded by nonReentrant).
        // Listing fee is a percentage of the pool, charged up front to treasury.
        uint256 listingFee = (prizePool * listingFeeBps) / BPS_DENOMINATOR;
        if (listingFee > 0) escrow.collectListingFee(msg.sender, listingFee);
        escrow.depositPrizePool(contestId, msg.sender, prizePool);

        emit ContestListed(contestId, msg.sender, cType, protocolTarget, prizePool);
    }

    // ============ Operator path ============

    /// @notice Enter an owned agent into an open contest. Qualification
    ///         thresholds (min points, etc.) are enforced off-chain by the
    ///         coordinator at scoring time; entry itself is permissionless for
    ///         agent owners.
    function registerEntry(uint256 contestId, uint256 agentId, uint256 syndicateId) external whenNotPaused {
        Contest storage c = _contests[contestId];
        if (c.sponsor == address(0)) revert ContestDoesNotExist();
        if (c.status != ContestStatus.OPEN) revert ContestNotOpen();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= c.endTime) revert ContestEnded();
        if (agentRegistry.ownerOfAgent(agentId) != msg.sender) revert NotAgentOwner();
        if (agentEntered[contestId][agentId]) revert AlreadyEntered();
        if (operatorEntered[contestId][msg.sender]) revert OperatorAlreadyEntered();

        // Tier gate: the agent's tier in this contest's family must sit within
        // [minTier, maxTier]. A fully open contest (0..MAX_TIER) never rejects.
        uint16 tier = agentRegistry.getTier(agentId, c.contestType);
        if (tier < c.minTier || tier > c.maxTier) {
            revert TierNotAllowed(tier, c.minTier, c.maxTier);
        }

        agentEntered[contestId][agentId] = true;
        operatorEntered[contestId][msg.sender] = true;
        unchecked {
            entryCount[contestId] += 1;
        }

        emit EntryRegistered(contestId, msg.sender, agentId, syndicateId);
    }

    /// @notice Claim a prize with a merkle proof of the `(operator, amount)`
    ///         leaf against the settled contest's root. Pull-based: each winner
    ///         claims their own share.
    /// @dev    Leaf is double-hashed to match OpenZeppelin's StandardMerkleTree
    ///         encoding `['address','uint256']`.
    function claimPrize(uint256 contestId, uint256 amount, bytes32[] calldata proof)
        external
        whenNotPaused
        nonReentrant
    {
        Contest storage c = _contests[contestId];
        if (c.status != ContestStatus.SETTLED) revert ContestNotSettled();
        if (prizeClaimed[contestId][msg.sender]) revert AlreadyClaimed();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        if (!MerkleProof.verify(proof, c.finalRoot, leaf)) revert InvalidProof();

        prizeClaimed[contestId][msg.sender] = true;
        escrow.payout(contestId, msg.sender, amount);

        emit PrizeClaimed(contestId, msg.sender, amount);
    }

    // ============ Coordinator path ============

    /// @notice Post the merkle root of final `(operator, amount)` payouts.
    ///         Only after the contest's entry window has ended.
    function postScoreRoot(uint256 contestId, bytes32 root) external onlyRole(COORDINATOR_ROLE) {
        Contest storage c = _contests[contestId];
        if (c.sponsor == address(0)) revert ContestDoesNotExist();
        if (c.status != ContestStatus.OPEN) revert ContestNotOpen();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < c.endTime) revert ContestNotEnded();
        if (root == bytes32(0)) revert InvalidRoot();

        c.finalRoot = root;
        c.status = ContestStatus.SCORING;

        emit ContestScored(contestId, root);
    }

    /// @notice Finalize a scored contest: skim the platform fee to treasury and
    ///         open the pool for winner claims.
    function settle(uint256 contestId) external onlyRole(COORDINATOR_ROLE) nonReentrant {
        Contest storage c = _contests[contestId];
        if (c.sponsor == address(0)) revert ContestDoesNotExist();
        if (c.status != ContestStatus.SCORING) revert ContestNotScoring();

        c.status = ContestStatus.SETTLED;

        uint256 platformFee = (c.prizePool * c.platformFeeBps) / BPS_DENOMINATOR;
        if (platformFee > 0) escrow.skimPlatformFee(contestId, platformFee);

        emit ContestSettled(contestId, c.prizePool - platformFee, platformFee);
    }

    /// @notice Apply in-game reputation deltas for a contest's agents. The
    ///         coordinator computes placements off-chain and chunks the call;
    ///         this forwards each delta to AgentRegistry (which only this
    ///         contract is authorized to call). Separate from the ERC-8004
    ///         ReputationRegistry feedback the validator wallet posts.
    function applyReputationDeltas(uint256 contestId, uint256[] calldata agentIds, int128[] calldata deltas)
        external
        onlyRole(COORDINATOR_ROLE)
    {
        Contest storage c = _contests[contestId];
        if (c.sponsor == address(0)) revert ContestDoesNotExist();
        if (c.status != ContestStatus.SCORING && c.status != ContestStatus.SETTLED) {
            revert ContestNotScoring();
        }

        uint256 n = agentIds.length;
        if (n != deltas.length) revert LengthMismatch();

        for (uint256 i = 0; i < n; i++) {
            agentRegistry.applyReputationChange(agentIds[i], deltas[i]);
        }

        emit ReputationApplied(contestId, n);
    }

    // ============ Admin / recovery ============

    /// @notice Cancel a contest before claims complete and refund the full
    ///         remaining pool to the sponsor. Coordinator or admin only.
    function cancelContest(uint256 contestId) external nonReentrant {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(COORDINATOR_ROLE, msg.sender)) {
            revert NotAuthorized();
        }

        Contest storage c = _contests[contestId];
        if (c.sponsor == address(0)) revert ContestDoesNotExist();
        if (c.status != ContestStatus.OPEN && c.status != ContestStatus.SCORING) {
            revert CannotCancel();
        }

        c.status = ContestStatus.CANCELLED;

        uint256 bal = escrow.poolBalance(address(this), contestId);
        if (bal > 0) escrow.payout(contestId, c.sponsor, bal);

        emit ContestCancelled(contestId, bal);
    }

    /// @notice After the claim window, sweep any unclaimed pool funds to the
    ///         treasury. Anyone can trigger recovery.
    function sweepUnclaimed(uint256 contestId) external {
        Contest storage c = _contests[contestId];
        if (c.sponsor == address(0)) revert ContestDoesNotExist();
        if (c.status != ContestStatus.SETTLED) revert ContestNotSettled();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < uint256(c.endTime) + CLAIM_WINDOW) revert ClaimWindowOpen();

        escrow.sweepUnclaimed(contestId);

        emit UnclaimedSwept(contestId);
    }

    function setListingFeeBps(uint16 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBps > MAX_LISTING_FEE_BPS) revert FeeTooHigh();
        emit ListingFeeUpdated(listingFeeBps, newBps);
        listingFeeBps = newBps;
    }

    function setDefaultPlatformFeeBps(uint16 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBps > MAX_PLATFORM_FEE_BPS) revert FeeTooHigh();
        emit PlatformFeeUpdated(defaultPlatformFeeBps, newBps);
        defaultPlatformFeeBps = newBps;
    }

    /// @notice Emergency stop: blocks new listings, entries, and claims. Admin
    ///         only. Settlement and recovery (cancel/refund/sweep) stay open so
    ///         a paused contest can still be unwound.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ============ Views ============

    function getContest(uint256 contestId) external view returns (Contest memory) {
        return _contests[contestId];
    }

    function nextContestId() external view returns (uint256) {
        return _nextContestId;
    }
}
