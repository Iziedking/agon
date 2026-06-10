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

/// Arcana Markets: external prediction market contract on Arc Testnet.
/// Source: github.com/stephdrealss/arcana-markets, src/App.js. Parimutuel
/// YES/NO pool, single-resolver admin model. createMarket / resolveMarket /
/// cancelMarket are owner-only; buyShares / claimWinnings / refund are open.
export const arcanaMarketsEvents = parseAbi([
  "event SharesBought(address indexed buyer, uint256 indexed marketId, bool isYes, uint256 usdcAmount, uint256 shares)",
  "event MarketResolved(uint256 indexed marketId, bool yesWon)",
  "event WinningsClaimed(uint256 indexed marketId, address indexed claimer, uint256 amount)",
]);

/// Full ABI including reads and writes. Use this when calling the contract;
/// use the events-only variant above when subscribing or decoding logs.
export const arcanaMarketsAbi = parseAbi([
  // reads
  "function marketCount() view returns (uint256)",
  "function owner() view returns (address)",
  "function markets(uint256) view returns (uint256 id, string title, string category, uint256 yesPool, uint256 noPool, uint256 endTime, bool resolved, bool cancelled)",
  "function getMarketOdds(uint256 marketId) view returns (uint256 yesOdds, uint256 noOdds)",
  "function yesShares(uint256, address) view returns (uint256)",
  "function noShares(uint256, address) view returns (uint256)",
  // writes (open to anyone)
  "function buyShares(uint256 marketId, bool isYes, uint256 usdcAmount)",
  "function claimWinnings(uint256 marketId)",
  "function refund(uint256 marketId)",
  // writes (owner only; calling will revert "Not owner" from non-owner)
  "function createMarket(string title, string category, uint256 endTime)",
  "function resolveMarket(uint256 marketId, bool yesWon)",
  "function cancelMarket(uint256 marketId)",
  // events
  "event SharesBought(address indexed buyer, uint256 indexed marketId, bool isYes, uint256 usdcAmount, uint256 shares)",
  "event MarketResolved(uint256 indexed marketId, bool yesWon)",
  "event WinningsClaimed(uint256 indexed marketId, address indexed claimer, uint256 amount)",
]);

/// Minimal ERC-20 ABI covering the surfaces ArcRun calls on USDC: approve
/// (before buyShares), allowance (preflight), balanceOf (autofund check),
/// and transfer (coordinator autofund drip).
export const usdcMinimalAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
