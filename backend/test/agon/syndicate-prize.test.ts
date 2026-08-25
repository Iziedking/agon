import assert from "node:assert/strict";
import test from "node:test";
import { buildAgonPrizeAllocation, buildAgonPrizeClaimPlan, buildAgonSyndicateContributionPlan, prizeClaimLeaf } from "../../src/agon/execution/syndicate-prize.ts";

const REGISTRY = "0xD77312288E4019bD3Fc7a6C0234B9c84D09C1Ab4";
const VAULT = "0xd3a538fD48FA81CF102E5b5381B47e46eC176D3b";
const HASH = "0x1111111111111111111111111111111111111111111111111111111111111111";
const BENEFICIARY = "0x0000000000000000000000000000000000000001";

test("syndicate contribution calldata pins key and evidence hash", () => {
  const plan = buildAgonSyndicateContributionPlan({ contract: REGISTRY, syndicateId: "7", agentId: "42", contributionKey: HASH, score: "900", evidenceHash: HASH });
  assert.equal(plan.chainId, 5042002); assert.equal(plan.args[0], 7n); assert.equal(plan.args[2], HASH); assert.match(plan.data, /^0x[0-9a-f]+$/);
});

test("prize claim plan uses the same double-hash leaf as AgonPrizeVault", () => {
  const input = { vault: VAULT, poolKey: HASH, index: "0", beneficiary: BENEFICIARY, amount: "1000", proof: [HASH] };
  const plan = buildAgonPrizeClaimPlan(input); assert.equal(plan.leaf, prizeClaimLeaf(input)); assert.equal(plan.args[1], 0n); assert.equal(plan.args[3], 1000n);
});

test("prize allocation conserves principal and assigns remainder to top rank", () => {
  const allocation = buildAgonPrizeAllocation({ poolBaseUnits: 101n, platformFeeBps: 0, winners: [
    { beneficiary: BENEFICIARY, rank: 1, weightBps: 3333 },
    { beneficiary: "0x0000000000000000000000000000000000000002", rank: 2, weightBps: 6667 },
  ] });
  assert.equal(allocation.distributableBaseUnits, 101n); assert.equal(allocation.shares.reduce((sum, share) => sum + share.amountBaseUnits, 0n), 101n); assert.equal(allocation.shares[0]?.amountBaseUnits, 34n);
});

test("claim planning accepts index zero and rejects malformed proof", () => {
  assert.throws(() => buildAgonPrizeClaimPlan({ vault: VAULT, poolKey: HASH, index: "1", beneficiary: BENEFICIARY, amount: "1", proof: ["0x00"] }), /Merkle proof item must be bytes32/);
  assert.equal(buildAgonPrizeClaimPlan({ vault: VAULT, poolKey: HASH, index: "0", beneficiary: BENEFICIARY, amount: "1", proof: [] }).args[1], 0n);
});
