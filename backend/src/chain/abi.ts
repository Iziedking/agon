import { parseAbi } from "viem";

/// Event ABIs for the six ArcRun contracts, as human-readable signatures.
/// Enum parameters (ContestType, ChallengeKind) are uint8 on the wire.

export const contestEngineEvents = parseAbi([
  "event ContestListed(uint256 indexed id, address indexed sponsor, uint8 indexed cType, address protocolTarget, uint256 prizePool)",
  "event EntryRegistered(uint256 indexed contestId, address indexed operator, uint256 indexed agentId, uint256 syndicateId)",
  "event ContestScored(uint256 indexed contestId, bytes32 scoreRoot)",
  "event ContestSettled(uint256 indexed contestId, uint256 paidOut, uint256 platformFee)",
  "event PrizeClaimed(uint256 indexed contestId, address indexed operator, uint256 amount)",
  "event ContestCancelled(uint256 indexed contestId, uint256 refunded)",
  "event UnclaimedSwept(uint256 indexed contestId)",
]);

export const challengeArenaEvents = parseAbi([
  "event ChallengeCreated(uint256 indexed id, address indexed creator, uint8 kind, uint128 stake)",
  "event ChallengeJoined(uint256 indexed id, address indexed operator, uint256 indexed agentId)",
  "event ChallengeLocked(uint256 indexed id, uint256 pot, uint64 entrants)",
  "event ChallengeSettled(uint256 indexed id, bytes32 winnerRoot)",
  "event ChallengePayoutClaimed(uint256 indexed id, address indexed operator, uint256 amount)",
  "event ChallengeCancelled(uint256 indexed id)",
  "event ChallengeRefunded(uint256 indexed id, address indexed operator, uint256 amount)",
]);

export const agentRegistryEvents = parseAbi([
  "event AgentCreated(uint256 indexed agentId, address indexed owner, uint256 erc8004TokenId)",
  "event AgentUpgraded(uint256 indexed agentId, uint8 indexed cType, uint16 newTier, uint256 usdcSpent)",
  "event ReputationUpdated(uint256 indexed agentId, uint128 newReputation, int128 delta)",
]);

export const pointsLedgerEvents = parseAbi([
  "event PointsCredited(address indexed operator, uint128 amount, uint256 indexed contestId, uint8 cType)",
  "event PointsDebited(address indexed operator, uint128 amount, uint256 indexed contestId)",
]);

export const syndicateFactoryEvents = parseAbi([
  "event SyndicateCreated(uint256 indexed id, address indexed founder, string name)",
  "event MemberJoined(uint256 indexed syndicateId, address indexed member)",
  "event MemberLeft(uint256 indexed syndicateId, address indexed member)",
  "event ContributionRecorded(uint256 indexed syndicateId, address indexed member, uint128 amount)",
  "event WeeklyWarSettled(uint256 indexed weekId, uint256[] syndicateIds, uint256[] pointsTotals)",
]);

export const prizeEscrowEvents = parseAbi([
  "event PrizePoolDeposited(address indexed controller, uint256 indexed poolId, address indexed from, uint256 amount)",
  "event ChallengePotDeposited(address indexed controller, uint256 indexed poolId, address indexed from, uint256 amount)",
  "event PaidOut(address indexed controller, uint256 indexed poolId, address indexed recipient, uint256 amount)",
]);
