import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";

import { createViemAgonProtocolFinalityReader, type AgonProtocolFinalityClient } from "../../src/agon/execution/protocol-finality.ts";

const ARENA = `0x${"11".repeat(20)}` as `0x${string}`;
const SYNDICATE = `0x${"22".repeat(20)}` as `0x${string}`;
const PRIZE = `0x${"33".repeat(20)}` as `0x${string}`;
const ACTOR = `0x${"44".repeat(20)}` as `0x${string}`;
const hash = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const tx = hash("9");

test("normalizes viem named Arena tuples for independent scope checks", async () => {
  const client = {
    readContract: async () => ({
      evaluationId: 7n, listingId: 8n, agentId: 9n, listingVersion: 2n, category: 7n,
      participant: ACTOR, manifestHash: hash("1"), capabilityHash: hash("2"), evaluatorVersionHash: hash("3"),
      taskCommitment: hash("4"), evidenceRoot: hash("5"), validationRequestHash: hash("6"),
      validationResponseHash: hash("7"), score: 96, requestedAt: 1n, submittedAt: 2n, scoredAt: 3n,
      expiresAt: 2_000_000_000n, state: 3,
    }),
    getTransactionReceipt: async () => { throw new Error("not used"); },
  } as AgonProtocolFinalityClient;
  const reader = createViemAgonProtocolFinalityReader({ client, arenaAddress: ARENA, syndicateRegistryAddress: SYNDICATE, prizeVaultAddress: PRIZE });
  const evaluation = await reader.inspectArenaEvaluation("7");
  assert.equal(evaluation.evaluationId, "7");
  assert.equal(evaluation.listingId, "8");
  assert.equal(evaluation.state, 3);
  assert.equal(evaluation.score, 96);
});

test("confirms exact syndicate contribution using mapping and receipt evidence", async () => {
  const event = parseAbiItem("event ContributionRecorded(uint256 indexed syndicateId,uint256 indexed agentId,bytes32 indexed contributionKey,uint256 score,bytes32 evidenceHash)");
  const client = {
    readContract: async () => true,
    getTransactionReceipt: async () => ({
      status: "success" as const,
      to: SYNDICATE,
      logs: [{
        address: SYNDICATE,
        topics: encodeEventTopics({ abi: [event], eventName: "ContributionRecorded", args: { syndicateId: 7n, agentId: 42n, contributionKey: hash("1") } }),
        data: encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [900n, hash("2")]),
      }],
    }),
  } as AgonProtocolFinalityClient;
  const reader = createViemAgonProtocolFinalityReader({ client, arenaAddress: ARENA, syndicateRegistryAddress: SYNDICATE, prizeVaultAddress: PRIZE });
  await reader.confirmSyndicateContribution({ transactionHash: tx, syndicateId: "7", agentId: "42", contributionKey: hash("1"), score: "900", evidenceHash: hash("2") });
  await assert.rejects(() => reader.confirmSyndicateContribution({ transactionHash: tx, syndicateId: "7", agentId: "42", contributionKey: hash("1"), score: "901", evidenceHash: hash("2") }), /exact syndicate contribution/);
});

test("confirms exact prize claim using claimed bitmap and receipt evidence", async () => {
  const event = parseAbiItem("event PrizeClaimed(bytes32 indexed poolKey,uint256 indexed index,address indexed beneficiary,uint256 amount)");
  const client = {
    readContract: async () => true,
    getTransactionReceipt: async () => ({
      status: "success" as const,
      to: PRIZE,
      logs: [{
        address: PRIZE,
        topics: encodeEventTopics({ abi: [event], eventName: "PrizeClaimed", args: { poolKey: hash("3"), index: 0n, beneficiary: ACTOR } }),
        data: encodeAbiParameters([{ type: "uint256" }], [1000n]),
      }],
    }),
  } as AgonProtocolFinalityClient;
  const reader = createViemAgonProtocolFinalityReader({ client, arenaAddress: ARENA, syndicateRegistryAddress: SYNDICATE, prizeVaultAddress: PRIZE });
  await reader.confirmPrizeClaim({ transactionHash: tx, poolKey: hash("3"), index: "0", beneficiary: ACTOR, amount: "1000" });
  await assert.rejects(() => reader.confirmPrizeClaim({ transactionHash: tx, poolKey: hash("3"), index: "0", beneficiary: ACTOR, amount: "1001" }), /exact prize claim/);
});
