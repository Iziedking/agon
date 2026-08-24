import { parseAbi } from "viem";

export const AGON_PROFILE_REGISTRY = "0xE0c7A2545C2f4eE6d2bD797B6f2742c73E640574" as const;
export const AGON_SERVICE_REGISTRY = "0x2144C156B0a4581da2D046C2E41AC41C6C3938CB" as const;

export const agonProfileRegistryAbi = parseAbi([
  "function bindProfile(uint256 id, string uri)",
]);

export const agonServiceRegistryAbi = parseAbi([
  "function publish(uint256 agentId, bytes32 serviceKey, bytes32 manifestHash, string uri, uint256 category, uint8 rail) returns (uint256 id)",
]);

export const agonJobEscrowAbi = parseAbi([
  "function createJob(bytes32 clientReference, uint256 listingId, bytes32 termsHash, uint256 amount, uint16 feeBps, uint64 reviewHours) returns (uint256 jobId)",
  "function acceptJob(uint256 jobId)",
  "function submitJob(uint256 jobId, bytes32 deliverableHash)",
  "function acceptSubmission(uint256 jobId)",
  "function autoAccept(uint256 jobId)",
  "function rejectSubmission(uint256 jobId, bytes32 reasonHash)",
  "function openDispute(uint256 jobId, bytes32 reasonHash)",
  "function resolveDispute(uint256 jobId, bool payProvider)",
  "function failJob(uint256 jobId)",
  "function getJob(uint256 jobId) view returns ((uint256 jobId,address buyer,address provider,uint256 listingId,uint256 agentId,uint256 listingVersion,bytes32 manifestHash,bytes32 termsHash,bytes32 deliverableHash,uint256 amount,uint256 fee,uint64 reviewHours,uint64 acceptanceDeadline,uint64 reviewDeadline,uint64 createdAt,uint64 submittedAt,uint8 status,uint8 settlement))",
]);

export const agonArenaAbi = parseAbi([
  "function requestEvaluation(bytes32 validationRequestHash,uint256 listingId,bytes32 capabilityHash,bytes32 evaluatorVersionHash,bytes32 taskCommitment,uint64 expiresAt) returns (uint256 evaluationId)",
  "function startEvaluation(uint256 evaluationId)",
  "function submitEvidence(uint256 evaluationId,bytes32 evidenceRoot)",
  "function scoreEvaluation(uint256 evaluationId,uint8 score,bytes32 validationResponseHash)",
  "function expireEvaluation(uint256 evaluationId)",
  "function getEvaluation(uint256 evaluationId) view returns ((uint256 evaluationId,uint256 listingId,uint256 agentId,uint256 listingVersion,uint256 category,address participant,bytes32 manifestHash,bytes32 capabilityHash,bytes32 evaluatorVersionHash,bytes32 taskCommitment,bytes32 evidenceRoot,bytes32 validationRequestHash,bytes32 validationResponseHash,uint8 score,uint64 requestedAt,uint64 submittedAt,uint64 scoredAt,uint64 expiresAt,uint8 state))",
]);

export const agonSyndicateRegistryAbi = parseAbi([
  "function createSyndicate(bytes32 nameHash,bytes32 campaignHash) returns (uint256 syndicateId)",
  "function joinSyndicate(uint256 syndicateId,uint256 agentId)",
  "function lockRoster(uint256 syndicateId)",
  "function startCompetition(uint256 syndicateId)",
  "function recordContribution(uint256 syndicateId,uint256 agentId,uint256 score,bytes32 evidenceRoot)",
  "function settleCampaign(uint256 syndicateId)",
  "function getSyndicate(uint256 syndicateId) view returns ((uint256 syndicateId,bytes32 nameHash,bytes32 campaignHash,address creator,uint8 state,uint64 createdAt,uint64 lockedAt,uint64 settledAt,uint256 memberCount))",
  "function getMemberAgentIds(uint256 syndicateId) view returns (uint256[])",
]);

export const agonPrizeVaultAbi = parseAbi([
  "function getPool(bytes32 poolKey) view returns ((bytes32 poolKey,uint8 kind,uint8 state,address sponsor,uint256 grossAmount,uint256 feeAmount,uint256 distributableAmount,uint256 claimedAmount,bytes32 payoutRoot,uint256 payoutTotal,uint64 claimDeadline,uint64 createdAt))",
  "function isClaimed(bytes32 poolKey,uint256 index) view returns (bool)",
  "function claim(bytes32 poolKey,uint256 index,address beneficiary,uint256 amount,bytes32[] proof)",
]);

export const agonUsdcAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
]);

