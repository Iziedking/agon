import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { keccak256, stringToHex } from "viem";

import { createProviderHandler, type ProviderDeliveryEvidence } from "../../src/agon/provider-handler.ts";
import { buildX402ExecutionApproval, X402_EXECUTION_APPROVAL_PHRASE } from "../../src/agon/execution/x402-execution-approval.ts";
import { buildX402ExecutionPlan } from "../../src/agon/execution/x402-facilitator.ts";
import { createX402ExecutionPolicy } from "../../src/agon/execution/x402-policy.ts";
import { createX402SettlementOrchestrator } from "../../src/agon/execution/x402-orchestrator.ts";
import { createArcTestnetReceiptLookupAdapter } from "../../src/agon/execution/x402-reconciliation.ts";
import { transitionX402Receipt, type X402ReceiptEvent } from "../../src/agon/execution/x402-receipt.ts";
import { createX402ProviderExecutionAdapter } from "../../src/agon/execution/x402-provider-execution.ts";
import { X402_EXECUTION_CONFIRMATION_PHRASE, type X402StoredApprovalEvidence } from "../../src/agon/execution/x402-settlement.ts";
import type { StoredX402CallReceipt } from "../../src/agon/store/repository.ts";

const NETWORK = "eip155:5042002" as const;
const ACTOR = "0x1111111111111111111111111111111111111111" as const;
const SELLER = "0x2222222222222222222222222222222222222222" as const;
const VERIFYING = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
const RESOURCE_URL = "https://provider.example/agon/review";
const TX = `0x${"ef".repeat(32)}` as const;
const NOW = 1_800_000_000;

type FakeResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  end(value?: string): void;
};

function fakeResponse(): FakeResponse {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    end(value = "") { this.body += value; },
  };
}

function fixture() {
  const authorization = {
    x402Version: 2 as const,
    domain: { name: "GatewayWalletBatched" as const, version: "1" as const, chainId: 5042002, verifyingContract: VERIFYING as `0x${string}` },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] } as const,
    primaryType: "TransferWithAuthorization" as const,
    message: { from: ACTOR, to: SELLER, value: "1000", validAfter: String(NOW - 60), validBefore: String(NOW + 600), nonce: `0x${"ab".repeat(32)}` as `0x${string}` },
  };
  const planned = buildX402ExecutionPlan({
    snapshot: {
      x402Version: 2,
      accepts: [{ scheme: "exact", network: NETWORK, asset: "0x3600000000000000000000000000000000000000", amount: "1000", payTo: SELLER, maxTimeoutSeconds: 600, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: VERIFYING } }],
      resource: { url: RESOURCE_URL, description: "Agon review", mimeType: "application/json" },
    },
    authorization,
    authorizationPayloadHash: `0x${"cd".repeat(32)}`,
    authorizationHash: keccak256(`0x${"12".repeat(65)}`),
    approvedAmountUSDC: "0.01",
    nowSeconds: NOW,
  });
  assert.equal(planned.ok, true);
  const approved = buildX402ExecutionApproval({
    intentId: "00000000-0000-4000-8000-000000000001",
    actor: ACTOR,
    plan: planned.value,
    request: { planHash: planned.value.planHash, approvalIdempotencyKey: "approval-local-proof", confirmation: X402_EXECUTION_APPROVAL_PHRASE },
    nowSeconds: NOW,
  });
  assert.equal(approved.ok, true);
  const approval: X402StoredApprovalEvidence = { ...approved.value, approvedAt: new Date(approved.value.approvedAt), expiresAt: new Date(approved.value.expiresAt) };
  const receipt: StoredX402CallReceipt = {
    receiptId: "00000000-0000-4000-8000-000000000002",
    intentId: approval.intentId,
    state: "authorization_submitted",
    approvedAmountUSDC: "0.01",
    quoteHash: `0x${"01".repeat(32)}`,
    quoteSnapshot: planned.value.snapshot,
    authorizationPayloadHash: `0x${"cd".repeat(32)}`,
    authorizationPayload: authorization,
    authorizationHash: approval.authorizationHash,
    settlementRef: null,
    providerTransferId: null,
    serviceStatus: null,
    paymentResponseHash: null,
    chargedAmountUSDC: null,
    failureCode: null,
    failureMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { plan: planned.value, approval, receipt, signature: `0x${"12".repeat(65)}` as `0x${string}` };
}

function memoryStore(initial: StoredX402CallReceipt) {
  let current = initial;
  return {
    getX402CallReceipt: async () => current,
    advanceX402CallReceipt: async (_intentId: string, event: X402ReceiptEvent) => {
      const transition = transitionX402Receipt(current.state, event);
      current = {
        ...current,
        state: transition.to,
        settlementRef: transition.patch.settlementRef ?? current.settlementRef,
        providerTransferId: transition.patch.providerTransferId ?? current.providerTransferId,
        serviceStatus: transition.patch.serviceStatus ?? current.serviceStatus,
        paymentResponseHash: transition.patch.paymentResponseHash ?? current.paymentResponseHash,
        failureCode: transition.patch.failureCode ?? current.failureCode,
        failureMessage: transition.patch.failureMessage ?? current.failureMessage,
        updatedAt: new Date(),
      };
      return current;
    },
    get current() { return current; },
  };
}

function rpcFixtureFetch() {
  return (async (_url: string | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string };
    const padded = (address: string) => `0x${"00".repeat(12)}${address.slice(2)}`;
    const response = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
    if (request.method === "eth_chainId") return response("0x4cef52");
    if (request.method === "eth_blockNumber") return response("0x65");
    if (request.method === "eth_getTransactionByHash") return response({ hash: TX, from: ACTOR });
    if (request.method === "eth_getTransactionReceipt") return response({
      transactionHash: TX,
      status: "0x1",
      blockNumber: "0x64",
      logs: [{
        address: "0x3600000000000000000000000000000000000000",
        topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a9df523b3ef", padded(ACTOR), padded(SELLER)],
        data: "0x3e8",
      }],
    });
    throw new Error(`unexpected RPC method ${request.method}`);
  }) as typeof fetch;
}

test("runs the complete local buyer -> provider -> facilitator -> Arc proof", async () => {
  const originalFetch = globalThis.fetch;
  try {
  const input = fixture();
  const providerHandler = createProviderHandler<{ task: string }, { verdict: string }>({
    handler: async (body, context) => ({ verdict: `${body.task}:${context.paymentTransaction === TX ? "paid" : "verified"}` }),
  });
  const gateway = createGatewayMiddleware({ sellerAddress: SELLER, networks: [NETWORK], facilitatorUrl: "https://gateway-api-testnet.circle.com" });
  let deliveryEvidence: ProviderDeliveryEvidence | null = null;
  let paymentResponse: string | null = null;

  globalThis.fetch = (async (url, init) => {
    const path = new globalThis.URL(String(url)).pathname;
    if (path.endsWith("/supported")) return new Response(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra: { verifyingContract: VERIFYING, assets: [{ symbol: "USDC", address: "0x3600000000000000000000000000000000000000" }] } }], extensions: [], signers: {} }), { status: 200 });
    if (path.endsWith("/verify")) return new Response(JSON.stringify({ isValid: true, payer: ACTOR }), { status: 200 });
    if (path.endsWith("/settle")) return new Response(JSON.stringify({ success: true, transaction: TX, network: NETWORK, payer: ACTOR }), { status: 200 });
    throw new Error(`unexpected facilitator request ${path}`);
  }) as typeof fetch;

  const providerFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const request = { url, headers, payment: undefined as any };
    const response = fakeResponse();
    let deliveryWork: Promise<void> | undefined;
    await gateway.require("$0.001")(request as any, response as any, () => {
      const payment = request.payment as { payer?: `0x${string}`; network?: typeof NETWORK; transaction?: string };
      deliveryWork = providerHandler.execute({
        requestId: "local-proof-request-001",
        body: String(init?.body ?? ""),
        idempotencyKey: headers["idempotency-key"] ?? "local-proof-001",
        payment: { payer: payment.payer ?? ACTOR, network: NETWORK, transaction: payment.transaction ?? TX },
      }).then((executed) => {
        deliveryEvidence = executed.evidence;
        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(executed.result));
      });
    });
    await deliveryWork;
    paymentResponse = response.headers["payment-response"] ?? null;
    return new Response(response.body, { status: response.statusCode, headers: response.headers });
  };

  const unpaid = await providerFetch(RESOURCE_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "review" }) });
  assert.equal(unpaid.status, 402);
  assert.ok(unpaid.headers.get("payment-required"));

  const buyer = createX402ProviderExecutionAdapter({ enabled: true, policy: createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" }), fetchImpl: providerFetch });
  const settled = await buyer.settle({
    approval: input.approval,
    plan: input.plan,
    signature: input.signature,
    confirmation: X402_EXECUTION_CONFIRMATION_PHRASE,
    nowSeconds: NOW,
    delivery: { targetUrl: RESOURCE_URL, method: "POST", input: { task: "review" }, idempotencyKey: "local-proof-001" },
  });
  assert.equal(settled.ok, true);
  if (!settled.ok || !settled.value.delivery || !deliveryEvidence || !paymentResponse) return;
  assert.deepEqual(settled.value.delivery.result, { verdict: "review:paid" });
  assert.equal(deliveryEvidence.serviceStatus, 200);
  assert.equal(deliveryEvidence.idempotencyKey, "local-proof-001");
  assert.equal(deliveryEvidence.responseBytes, Buffer.byteLength(JSON.stringify({ verdict: "review:paid" }), "utf8"));
  assert.notEqual(deliveryEvidence.responseHash, settled.value.delivery.responseHash);
  const decoded = decodePaymentResponseHeader(paymentResponse);
  assert.equal(decoded.success, true);
  assert.equal(decoded.transaction, TX);
  assert.equal(decoded.network, NETWORK);

  const store = memoryStore(input.receipt);
  const orchestrator = createX402SettlementOrchestrator({
    store,
    policy: createX402ExecutionPolicy({ enabled: true, maxAmountBaseUnits: "1000" }),
    adapter: buyer,
  });
  const orchestrated = await orchestrator.settle({
    approval: input.approval,
    plan: input.plan,
    signature: input.signature,
    confirmation: X402_EXECUTION_CONFIRMATION_PHRASE,
    nowSeconds: NOW,
    delivery: { targetUrl: RESOURCE_URL, method: "POST", input: { task: "review" }, idempotencyKey: "local-proof-001" },
  });
  assert.equal(orchestrated.ok, true);
  if (!orchestrated.ok || !orchestrated.delivery) return;
  assert.equal(store.current.state, "settlement_submitted");
  assert.equal(store.current.settlementRef, TX);
  await store.advanceX402CallReceipt(input.approval.intentId, { type: "service_delivered", serviceStatus: 200, paymentResponseHash: keccak256(stringToHex(paymentResponse)), chargedAmountUSDC: "0.01" });
  assert.equal(store.current.state, "service_delivered");

  const arc = createArcTestnetReceiptLookupAdapter({ enabled: true, minConfirmations: 1, fetchImpl: rpcFixtureFetch() });
  const reconciliation = await arc.lookup({ network: NETWORK, transaction: TX, expected: { payer: ACTOR, recipient: SELLER, amountAtomicUnits: "1000" } });
  assert.equal(reconciliation.status, "confirmed");
  const final = await orchestrator.reconcile(input.approval.intentId, reconciliation);
  assert.equal(final.ok, true);
  if (final.ok) assert.equal(final.state, "reconciled");
  assert.equal(store.current.state, "reconciled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps an unknown Arc outcome in reconciliation", async () => {
  const input = fixture();
  const pendingRpc = (async (_url: string | URL, init?: RequestInit) => {
    const method = (JSON.parse(String(init?.body)) as { method: string }).method;
    const result = method === "eth_chainId" ? "0x4cef52" : method === "eth_getTransactionByHash" ? { hash: TX, from: ACTOR } : null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  }) as typeof fetch;
  const arc = createArcTestnetReceiptLookupAdapter({ enabled: true, fetchImpl: pendingRpc });
  const pending = await arc.lookup({ network: NETWORK, transaction: TX, expected: { payer: ACTOR, recipient: SELLER, amountAtomicUnits: "1000" } });
  assert.equal(pending.status, "pending");
  assert.match(pending.reason ?? "", /not available/);
});
