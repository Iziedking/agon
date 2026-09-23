import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { AgonListingView } from "../../src/agon/http/api-types.ts";
import { prepareX402Call } from "../../src/agon/execution/x402-intent.ts";
import { parsePaymentRequiredHeader } from "../../src/agon/execution/x402-quote.ts";
import { buildX402Authorization, validateX402AuthorizationSignature } from "../../src/agon/execution/x402-authorization.ts";
import { buildX402ExecutionPlan } from "../../src/agon/execution/x402-facilitator.ts";
import { buildX402ExecutionApproval, X402_EXECUTION_APPROVAL_PHRASE } from "../../src/agon/execution/x402-execution-approval.ts";
import { createX402ExecutionPolicy } from "../../src/agon/execution/x402-policy.ts";
import { createX402ProviderExecutionAdapter } from "../../src/agon/execution/x402-provider-execution.ts";
import { createX402SettlementOrchestrator } from "../../src/agon/execution/x402-orchestrator.ts";
import { createArcTestnetReceiptLookupAdapter } from "../../src/agon/execution/x402-reconciliation.ts";
import { X402_EXECUTION_CONFIRMATION_PHRASE } from "../../src/agon/execution/x402-settlement.ts";
import { PostgresAgonRepository } from "../../src/agon/store/repository.ts";
import { createAgonTestDatabase } from "./database-test-helper.ts";

const NETWORK = "eip155:5042002" as const;
const REGISTRY = "0x3333333333333333333333333333333333333333";
const SELLER = "0x2222222222222222222222222222222222222222" as const;
const VERIFYING = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
const ASSET = "0x3600000000000000000000000000000000000000" as const;
const ENDPOINT = "https://provider.example/agon/review";
const TX = `0x${"ef".repeat(32)}` as const;
// Deliberately public test-only key. No external request or funded wallet is used.
const account = privateKeyToAccount(`0x${"01".repeat(32)}`);

function listing(): AgonListingView {
  const hash = `0x${"11".repeat(32)}`;
  return {
    id: `5042002:${REGISTRY}:1`, chainId: "5042002", serviceRegistry: REGISTRY,
    listingId: "1", agentId: "42", serviceKey: hash, category: "8", version: "1",
    manifest: { hash, uri: "https://provider.example/agon/manifest/v1.json" },
    providerSnapshot: SELLER, status: "Listed",
    verification: { status: "Verified", scope: { agentId: "42", listingId: "1", version: "1", category: "8" } },
    risk: { unverified: false, warning: null, quarantineReason: null },
    endpointQa: {
      status: "passed", endpointUrl: ENDPOINT, checkedAt: "2026-09-23T00:00:00.000Z",
      endpointStatus: 402, evidenceHash: hash, reason: "Provider returned HTTP 402.",
      attempts: 3, passedAttempts: 3, successRate: 100,
    },
    payment: { rail: "X402", directX402: true, escrowEligible: false },
    provenance: { sourceBlockNumber: "100", sourceTxHash: hash, sourceLogIndex: 0 },
  };
}

function rpcFetch(buyer: string): typeof fetch {
  const padded = (address: string) => `0x${"00".repeat(12)}${address.slice(2)}`;
  return (async (_url: string | URL, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body)) as { method: string };
    const result = method === "eth_chainId" ? "0x4cef52"
      : method === "eth_blockNumber" ? "0x65"
      : method === "eth_getTransactionByHash" ? { hash: TX, from: buyer }
      : method === "eth_getTransactionReceipt" ? {
        transactionHash: TX, status: "0x1", blockNumber: "0x64",
        logs: [{
          address: ASSET,
          topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a9df523b3ef", padded(buyer), padded(SELLER)],
          data: "0x3e8",
        }],
      } : null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  }) as typeof fetch;
}

test("persists the reviewed x402 hire through provider delivery, restart and Arc receipt reconciliation", async () => {
  const database = await createAgonTestDatabase("x402hire");
  try {
    let repository = new PostgresAgonRepository(database.pool);
    const reviewed = listing();
    const task = { task: "review an Arc contract" };
    const rejectedEndpoint = prepareX402Call(account.address, reviewed, {
      idempotencyKey: "hire-wrong-endpoint", method: "POST", input: task,
      maxAmountUSDC: "0.01", endpointUrl: "https://other.example/execute",
    });
    assert.equal(rejectedEndpoint.ok, false);
    const prepared = prepareX402Call(account.address, reviewed, {
      idempotencyKey: "hire-reviewed-endpoint", method: "POST", input: task,
      maxAmountUSDC: "0.01", endpointUrl: ENDPOINT,
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const intentId = randomUUID();
    const intent = await repository.prepareX402CallIntent({
      intentId, actor: prepared.value.actor, idempotencyKey: prepared.value.idempotencyKey,
      listingReference: reviewed.id, chainId: 5042002n, serviceRegistry: REGISTRY,
      listingId: 1n, agentId: 42n, version: 1n, method: "POST", input: task,
      inputHash: prepared.value.inputHash, maxAmountUSDC: "0.01",
      targetUrl: prepared.value.targetUrl, state: "prepared",
    });
    assert.equal(intent.targetUrl, ENDPOINT);
    const receipt = await repository.createX402CallReceipt({
      receiptId: randomUUID(), intentId, state: "prepared", quoteHash: null,
      authorizationHash: null, settlementRef: null, serviceStatus: null,
      paymentResponseHash: null, chargedAmountUSDC: null, failureCode: null,
      failureMessage: null,
    });
    await repository.approveX402CallReceipt(intentId, "0.01");

    const quoteBody = {
      x402Version: 2, resource: { url: ENDPOINT, description: "contract review", mimeType: "application/json" },
      accepts: [{ scheme: "exact", network: NETWORK, asset: ASSET, amount: "1000", payTo: SELLER,
        maxTimeoutSeconds: 600, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: VERIFYING } }],
    };
    const quoteHeader = Buffer.from(JSON.stringify(quoteBody)).toString("base64");
    const quote = parsePaymentRequiredHeader(quoteHeader, intent.targetUrl!, "5042002", "0.01");
    assert.equal(quote.ok, true);
    if (!quote.ok) return;
    assert.equal(parsePaymentRequiredHeader(quoteHeader, "https://other.example/execute", "5042002", "0.01").ok, false);
    await repository.advanceX402CallReceipt(intentId, { type: "payment_required", quoteHash: quote.value.quoteHash, quoteSnapshot: quote.value.snapshot });

    const now = Math.floor(Date.now() / 1000);
    const authorization = buildX402Authorization(account.address, "5042002", quote.value.snapshot, now);
    assert.equal(authorization.ok, true);
    if (!authorization.ok) return;
    const payload = authorization.value.payload;
    const signature = await account.signTypedData({
      domain: payload.domain, types: payload.types, primaryType: payload.primaryType,
      message: { ...payload.message, value: BigInt(payload.message.value), validAfter: BigInt(payload.message.validAfter), validBefore: BigInt(payload.message.validBefore) },
    });
    const signed = await validateX402AuthorizationSignature(payload, signature, account.address, now);
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    await repository.advanceX402CallReceipt(intentId, { type: "authorization_ready", authorizationPayloadHash: authorization.value.payloadHash, authorizationPayload: payload });
    await repository.advanceX402CallReceipt(intentId, { type: "authorization_submitted", authorizationHash: signed.value.signatureHash });
    const plan = buildX402ExecutionPlan({ snapshot: quote.value.snapshot, authorization: payload,
      authorizationPayloadHash: authorization.value.payloadHash, authorizationHash: signed.value.signatureHash,
      approvedAmountUSDC: "0.01", nowSeconds: now });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const approved = buildX402ExecutionApproval({ intentId, actor: account.address, plan: plan.value,
      request: { planHash: plan.value.planHash, approvalIdempotencyKey: "hire-approval-001", confirmation: X402_EXECUTION_APPROVAL_PHRASE }, nowSeconds: now });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    const approval = await repository.recordX402ExecutionApproval({ ...approved.value,
      approvedAt: new Date(approved.value.approvedAt), expiresAt: new Date(approved.value.expiresAt) });

    let paidProviderCalls = 0;
    const result = { verdict: "review complete" };
    const paymentResponse = encodePaymentResponseHeader({ success: true, transaction: TX, network: NETWORK,
      payer: account.address, amount: "1000" });
    const provider = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      assert.equal(String(url), ENDPOINT);
      const headers = new Headers(init?.headers);
      const payment = headers.get("payment-signature");
      if (!payment) return new Response("", { status: 402, headers: { "payment-required": quoteHeader } });
      paidProviderCalls += 1;
      const decoded = decodePaymentSignatureHeader(payment);
      assert.equal(decoded.accepted.amount, "1000");
      assert.equal(decoded.accepted.payTo.toLowerCase(), SELLER.toLowerCase());
      assert.deepEqual(JSON.parse(String(init?.body)), task);
      assert.equal(headers.get("idempotency-key"), intent.idempotencyKey);
      return new Response(JSON.stringify(result), { status: 200,
        headers: { "content-type": "application/json", "payment-response": paymentResponse } });
    };
    const unpaid = await provider(ENDPOINT, { method: "POST", body: JSON.stringify(task) });
    assert.equal(unpaid.status, 402);
    const policy = createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" });
    const adapter = createX402ProviderExecutionAdapter({ enabled: true, policy, fetchImpl: provider as typeof fetch });
    const execution = { approval, plan: plan.value, signature, confirmation: X402_EXECUTION_CONFIRMATION_PHRASE,
      nowSeconds: now, delivery: { targetUrl: intent.targetUrl!, method: "POST" as const, input: task,
        idempotencyKey: intent.idempotencyKey } };
    const mismatched = await adapter.settle({ ...execution,
      delivery: { ...execution.delivery, targetUrl: "https://other.example/execute" } });
    assert.equal(mismatched.ok, false);
    assert.equal(paidProviderCalls, 0);
    const orchestrator = createX402SettlementOrchestrator({ store: repository, policy, adapter });
    const settled = await orchestrator.settle(execution);
    assert.equal(settled.ok, true);
    if (!settled.ok || !settled.delivery) return;
    assert.equal(settled.receipt.state, "settlement_submitted");
    assert.equal(settled.transaction, TX);
    assert.deepEqual(settled.delivery.result, result);
    assert.equal(paidProviderCalls, 1);

    repository = new PostgresAgonRepository(database.pool);
    assert.equal((await repository.getX402CallIntent(intentId))?.targetUrl, ENDPOINT);
    const restarted = createX402SettlementOrchestrator({ store: repository, policy, adapter });
    const retry = await restarted.settle(execution);
    assert.equal(retry.ok, true);
    assert.equal(paidProviderCalls, 1);

    await repository.recordX402DeliveryEvidence({
      deliveryId: randomUUID(), intentId, receiptId: receipt.receiptId, provider: SELLER,
      listingReference: reviewed.id, serviceStatus: settled.delivery.serviceStatus,
      latencyMs: settled.delivery.latencyMs, responseHash: settled.delivery.responseHash,
      resultAttestationHash: null, chargedAmountUSDC: "0.001",
      deliveredAt: new Date(settled.delivery.deliveredAt),
    }, settled.delivery.paymentResponseHash);
    const delivered = await repository.getX402CallReceipt(intentId);
    assert.equal(delivered?.state, "service_delivered");
    assert.equal(delivered?.paymentResponseHash, keccak256(stringToHex(paymentResponse)));
    assert.notEqual(delivered?.paymentResponseHash, settled.delivery.responseHash);
    assert.equal((await repository.getLatestX402DeliveryEvidence(intentId))?.responseHash, settled.delivery.responseHash);

    const arc = createArcTestnetReceiptLookupAdapter({ enabled: true, minConfirmations: 1,
      fetchImpl: rpcFetch(account.address) });
    const wrongPayee = await arc.lookup({ network: NETWORK, transaction: TX,
      expected: { payer: account.address, recipient: REGISTRY, amountAtomicUnits: "1000" } });
    assert.notEqual(wrongPayee.status, "confirmed");
    const chainEvidence = await arc.lookup({ network: NETWORK, transaction: TX,
      expected: { payer: account.address, recipient: SELLER, amountAtomicUnits: "1000" } });
    assert.equal(chainEvidence.status, "confirmed");
    const final = await restarted.reconcile(intentId, chainEvidence);
    assert.equal(final.ok, true);
    assert.equal((await repository.getX402CallReceipt(intentId))?.state, "reconciled");
    assert.equal(paidProviderCalls, 1);
  } finally {
    await database.close();
  }
});
