// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { ContestType } from "./types/ArcRunTypes.sol";
import { IIdentityRegistry } from "./interfaces/IIdentityRegistry.sol";

/// @title  AgentRegistry
/// @notice In-game ownership ledger for ArcRun agents. Mints an ERC-8004
///         identity NFT for each agent via the Arc IdentityRegistry, tracks
///         per-contest-type tier upgrades paid in USDC, and stores the raw
///         reputation that ContestEngine writes to on settlement.
/// @dev    Identity-ownership design (variant A, see ARCRUN_PLAN.md §4.2):
///         the AgentRegistry CONTRACT is the on-chain owner of every minted
///         ERC-8004 NFT. The validator wallet (a separate EOA, operated off-
///         chain) is what calls ReputationRegistry.giveFeedback, satisfying
///         the ERC-8004 no-self-feedback constraint because the validator
///         address differs from this contract's address.
///
///         Reputation is stored raw, scaled by 1e6; `getEffectiveReputation`
///         applies 0.4%/day exponential decay lazily on read. The stored
///         value is rebased to its decayed form on every applyReputationChange
///         call so the read-time loop bound stays small.
contract AgentRegistry is AccessControl, IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Roles ============

    bytes32 public constant CONTEST_ENGINE_ROLE = keccak256("CONTEST_ENGINE_ROLE");

    // ============ Constants ============

    /// @notice Highest tier available. The progression is sequential 0..4 per
    ///         contest type, so an agent has 5 reachable tiers (0 is the
    ///         claim-and-play baseline; 4 is the maxed top-of-curve).
    uint16 public constant MAX_TIER = 4;

    /// @notice Reputation values are stored at 1e6 precision.
    uint256 public constant REPUTATION_SCALE = 1e6;

    /// @dev 0.996 daily survival rate ⇒ 0.4%/day exponential decay.
    uint256 private constant DECAY_NUMERATOR = 996;
    uint256 private constant DECAY_DENOMINATOR = 1_000;

    /// @dev Hard cap on lazy-decay iterations to keep `getEffectiveReputation`
    ///      gas-bounded. After this many days, decay is treated as saturated.
    uint256 private constant MAX_DECAY_DAYS = 365;

    // ============ Immutables ============

    IIdentityRegistry public immutable identityRegistry;
    IERC20 public immutable usdc;

    // ============ Mutable state ============

    address public treasury;
    uint16 public maxAgentsPerOwner;

    struct Agent {
        address owner;
        uint16 scoutTier;
        uint16 analystTier;
        uint16 solverTier;
        uint128 reputation;
        uint64 lastActivityAt;
        uint64 createdAt;
        uint256 erc8004TokenId;
    }

    uint256 private _nextAgentId = 1;
    mapping(uint256 => Agent) private _agents;
    mapping(address => uint256[]) private _agentsByOwner;

    /// @notice upgradePrice[cType][fromTier] = USDC (6 decimals) to advance
    ///         one tier, from `fromTier` to the tier above it.
    mapping(ContestType => mapping(uint16 => uint256)) public upgradePrice;

    /// @dev Set by `onERC721Received` during a register() call so we can
    ///      recover the minted tokenId even if the IdentityRegistry doesn't
    ///      return it. Cleared before and after each createAgent.
    uint256 private _pendingTokenId;

    // ============ Events ============

    event AgentCreated(uint256 indexed agentId, address indexed owner, uint256 erc8004TokenId);
    event AgentUpgraded(
        uint256 indexed agentId,
        ContestType indexed cType,
        uint16 newTier,
        uint256 usdcSpent
    );
    event ReputationUpdated(uint256 indexed agentId, uint128 newReputation, int128 delta);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event MaxAgentsPerOwnerUpdated(uint16 oldMax, uint16 newMax);
    event UpgradePriceSet(ContestType indexed cType, uint16 indexed fromTier, uint256 priceUSDC);

    // ============ Errors ============

    error ZeroAddress();
    error EmptyMetadata();
    error TooManyAgents(uint16 max);
    error NotAgentOwner();
    error AgentDoesNotExist();
    error InvalidTier(uint16 tier);
    error MustUpgradeSequentially(uint16 currentTier, uint16 requestedTier);
    error UpgradePriceUnset();
    error IdentityRegistryCallFailed();
    error TokenIdCaptureFailed();

    // ============ Constructor ============

    constructor(
        address admin,
        address identityRegistryAddr,
        address usdcAddr,
        address treasuryAddr
    ) {
        if (admin == address(0)) revert ZeroAddress();
        if (identityRegistryAddr == address(0)) revert ZeroAddress();
        if (usdcAddr == address(0)) revert ZeroAddress();
        if (treasuryAddr == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        identityRegistry = IIdentityRegistry(identityRegistryAddr);
        usdc = IERC20(usdcAddr);
        treasury = treasuryAddr;
        maxAgentsPerOwner = 6;

        _seedUpgradePrices();
    }

    function _seedUpgradePrices() private {
        // USDC has 6 decimals on Arc. Five tiers means four upgrade steps per
        // contest type (0->1, 1->2, 2->3, 3->4). Curve steepens so maxing an
        // agent is a real spend; t3->t4 is the gatekeeper for the top of the
        // leaderboard.
        // SCOUT progression
        upgradePrice[ContestType.SCOUT][0] = 10_000_000;     // 10 USDC
        upgradePrice[ContestType.SCOUT][1] = 50_000_000;     // 50 USDC
        upgradePrice[ContestType.SCOUT][2] = 200_000_000;    // 200 USDC
        upgradePrice[ContestType.SCOUT][3] = 500_000_000;    // 500 USDC
        // ANALYST progression
        upgradePrice[ContestType.ANALYST][0] = 8_000_000;    // 8 USDC
        upgradePrice[ContestType.ANALYST][1] = 40_000_000;   // 40 USDC
        upgradePrice[ContestType.ANALYST][2] = 160_000_000;  // 160 USDC
        upgradePrice[ContestType.ANALYST][3] = 400_000_000;  // 400 USDC
        // SOLVER progression
        upgradePrice[ContestType.SOLVER][0] = 12_000_000;    // 12 USDC
        upgradePrice[ContestType.SOLVER][1] = 60_000_000;    // 60 USDC
        upgradePrice[ContestType.SOLVER][2] = 240_000_000;   // 240 USDC
        upgradePrice[ContestType.SOLVER][3] = 600_000_000;   // 600 USDC

        emit UpgradePriceSet(ContestType.SCOUT, 0, 10_000_000);
        emit UpgradePriceSet(ContestType.SCOUT, 1, 50_000_000);
        emit UpgradePriceSet(ContestType.SCOUT, 2, 200_000_000);
        emit UpgradePriceSet(ContestType.SCOUT, 3, 500_000_000);
        emit UpgradePriceSet(ContestType.ANALYST, 0, 8_000_000);
        emit UpgradePriceSet(ContestType.ANALYST, 1, 40_000_000);
        emit UpgradePriceSet(ContestType.ANALYST, 2, 160_000_000);
        emit UpgradePriceSet(ContestType.ANALYST, 3, 400_000_000);
        emit UpgradePriceSet(ContestType.SOLVER, 0, 12_000_000);
        emit UpgradePriceSet(ContestType.SOLVER, 1, 60_000_000);
        emit UpgradePriceSet(ContestType.SOLVER, 2, 240_000_000);
        emit UpgradePriceSet(ContestType.SOLVER, 3, 600_000_000);
    }

    // ============ Player paths ============

    /// @notice Mint a new ArcRun agent for `msg.sender` and register its
    ///         ERC-8004 identity NFT (held by this contract).
    function createAgent(string calldata metadataURI)
        external
        nonReentrant
        returns (uint256 agentId)
    {
        if (bytes(metadataURI).length == 0) revert EmptyMetadata();

        uint256[] storage owned = _agentsByOwner[msg.sender];
        if (owned.length >= maxAgentsPerOwner) revert TooManyAgents(maxAgentsPerOwner);

        uint256 erc8004TokenId = _registerIdentity(metadataURI);

        agentId = _nextAgentId++;
        _agents[agentId] = Agent({
            owner: msg.sender,
            scoutTier: 0,
            analystTier: 0,
            solverTier: 0,
            reputation: 0,
            lastActivityAt: uint64(block.timestamp),
            createdAt: uint64(block.timestamp),
            erc8004TokenId: erc8004TokenId
        });
        owned.push(agentId);

        emit AgentCreated(agentId, msg.sender, erc8004TokenId);
    }

    /// @notice Spend USDC to upgrade an agent's tier in one contest type.
    ///         Upgrades must be sequential (tier N → tier N+1).
    function upgradeAgent(uint256 agentId, ContestType cType, uint16 newTier)
        external
        nonReentrant
    {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentDoesNotExist();
        if (agent.owner != msg.sender) revert NotAgentOwner();
        if (newTier == 0 || newTier > MAX_TIER) revert InvalidTier(newTier);

        uint16 currentTier = _tierOf(agent, cType);
        if (newTier != currentTier + 1) {
            revert MustUpgradeSequentially(currentTier, newTier);
        }

        uint256 price = upgradePrice[cType][currentTier];
        if (price == 0) revert UpgradePriceUnset();

        usdc.safeTransferFrom(msg.sender, treasury, price);
        _setTier(agent, cType, newTier);

        emit AgentUpgraded(agentId, cType, newTier, price);
    }

    // ============ Privileged paths ============

    /// @notice Apply a reputation delta to `agentId`. Called by ContestEngine
    ///         once per entry at settlement, including delta=0 for losers
    ///         (which still resets `lastActivityAt` to keep them "active").
    function applyReputationChange(uint256 agentId, int128 delta)
        external
        onlyRole(CONTEST_ENGINE_ROLE)
    {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentDoesNotExist();

        // Rebase the stored value to its decayed-as-of-now form so the delta
        // applies to the correct base.
        uint128 decayed = _decayedReputation(agent.reputation, agent.lastActivityAt);

        int256 newRep = int256(uint256(decayed)) + int256(delta);
        if (newRep < 0) newRep = 0;
        // Safe: uint128 max fits comfortably in int256 (2^128 < 2^255).
        // forge-lint: disable-next-line(unsafe-typecast)
        if (uint256(newRep) > type(uint128).max) newRep = int256(uint256(type(uint128).max));

        // forge-lint: disable-next-line(unsafe-typecast)
        agent.reputation = uint128(uint256(newRep));
        agent.lastActivityAt = uint64(block.timestamp);

        emit ReputationUpdated(agentId, agent.reputation, delta);
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setMaxAgentsPerOwner(uint16 newMax) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit MaxAgentsPerOwnerUpdated(maxAgentsPerOwner, newMax);
        maxAgentsPerOwner = newMax;
    }

    function setUpgradePrice(ContestType cType, uint16 fromTier, uint256 priceUSDC)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (fromTier >= MAX_TIER) revert InvalidTier(fromTier);
        upgradePrice[cType][fromTier] = priceUSDC;
        emit UpgradePriceSet(cType, fromTier, priceUSDC);
    }

    // ============ Views ============

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return _agents[agentId];
    }

    function agentsOf(address owner) external view returns (uint256[] memory) {
        return _agentsByOwner[owner];
    }

    /// @notice In-game owner of `agentId`, or address(0) if it doesn't exist.
    /// @dev    Minimal accessor consumed by ContestEngine / ChallengeArena to
    ///         verify entry ownership without pulling the whole Agent struct.
    function ownerOfAgent(uint256 agentId) external view returns (address) {
        return _agents[agentId].owner;
    }

    function nextAgentId() external view returns (uint256) {
        return _nextAgentId;
    }

    function getTier(uint256 agentId, ContestType cType) external view returns (uint16) {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) return 0;
        return _tierOf(agent, cType);
    }

    function getEffectiveReputation(uint256 agentId) public view returns (uint128) {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) return 0;
        return _decayedReputation(agent.reputation, agent.lastActivityAt);
    }

    // ============ ERC-721 receiver hook ============

    /// @notice Captures the minted tokenId from IdentityRegistry's `_safeMint`
    ///         callback. The captured value is used as a fallback when the
    ///         registry's `register` doesn't return tokenId directly.
    function onERC721Received(address, address, uint256 tokenId, bytes calldata)
        external
        override
        returns (bytes4)
    {
        if (msg.sender == address(identityRegistry)) {
            _pendingTokenId = tokenId;
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    // ============ Internals ============

    /// @dev Calls IdentityRegistry.register defensively. Tries the return
    ///      value first; falls back to the value captured by
    ///      `onERC721Received` (if the registry uses `_safeMint`). Reverts
    ///      with `TokenIdCaptureFailed` if neither path yields a non-zero id.
    function _registerIdentity(string calldata metadataURI) internal returns (uint256 tokenId) {
        _pendingTokenId = 0;

        (bool ok, bytes memory data) = address(identityRegistry).call(
            abi.encodeWithSelector(IIdentityRegistry.register.selector, metadataURI)
        );
        if (!ok) revert IdentityRegistryCallFailed();

        if (data.length >= 32) {
            tokenId = abi.decode(data, (uint256));
        }

        if (tokenId == 0) {
            tokenId = _pendingTokenId;
        }
        _pendingTokenId = 0;

        if (tokenId == 0) revert TokenIdCaptureFailed();
    }

    function _tierOf(Agent storage agent, ContestType cType) internal view returns (uint16) {
        if (cType == ContestType.SCOUT) return agent.scoutTier;
        if (cType == ContestType.ANALYST) return agent.analystTier;
        return agent.solverTier;
    }

    function _setTier(Agent storage agent, ContestType cType, uint16 newTier) internal {
        if (cType == ContestType.SCOUT) {
            agent.scoutTier = newTier;
        } else if (cType == ContestType.ANALYST) {
            agent.analystTier = newTier;
        } else {
            agent.solverTier = newTier;
        }
    }

    function _decayedReputation(uint128 rawReputation, uint64 lastActivityAt)
        internal
        view
        returns (uint128)
    {
        if (rawReputation == 0) return 0;

        // Day-granular decay is tolerant to the ~seconds of timestamp drift a
        // validator could induce; no economic incentive to manipulate this view.
        // forge-lint: disable-next-line(block-timestamp)
        uint256 elapsed = block.timestamp > lastActivityAt
            ? block.timestamp - uint256(lastActivityAt)
            : 0;
        uint256 daysElapsed = elapsed / 1 days;
        if (daysElapsed == 0) return rawReputation;
        if (daysElapsed > MAX_DECAY_DAYS) daysElapsed = MAX_DECAY_DAYS;

        uint256 rep = rawReputation;
        for (uint256 i = 0; i < daysElapsed; i++) {
            rep = (rep * DECAY_NUMERATOR) / DECAY_DENOMINATOR;
        }
        // Safe: rep starts as uint128 and only ever shrinks (multiplied by 996/1000).
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(rep);
    }
}
