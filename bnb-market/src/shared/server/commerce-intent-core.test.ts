import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, erc20Abi } from "viem";
import { COMMERCE_WRITE_ABI, LP_EXECUTION_BUFFER_SECONDS, jobExpiry, lpCommerceConfig,
  lpNegotiationRequest, parseCommerceIntentId, preparedTransaction, signedQuoteFields } from "./commerce-intent-core.ts";

const commerce = "0x1111111111111111111111111111111111111111" as const;
const router = "0x2222222222222222222222222222222222222222" as const;
const policy = "0x3333333333333333333333333333333333333333" as const;
const token = "0x4444444444444444444444444444444444444444" as const;
const provider = "0x5555555555555555555555555555555555555555" as const;
const intentId = "660b90bd-9f3d-4d19-8d60-6a171c35e38e";

test("hiring stays disabled until every operator-controlled boundary is configured", () => {
  const unavailable = lpCommerceConfig({});
  assert.equal(unavailable.ready, false);
  if (!unavailable.ready) assert.deepEqual(unavailable.blockers, [
    "hiring_flag_disabled", "agent_identity_unconfigured", "provider_wallet_unconfigured",
    "exact_price_unconfigured", "public_provider_url_unconfigured", "altana_session_unconfigured",
  ]);
  const ready = lpCommerceConfig({ BNB_LP_AGENT_HIRING_ENABLED: "true", BNB_LP_AGENT_ID: "42",
    BNB_LP_AGENT_ADDRESS: provider, BNB_LP_AGENT_PRICE_RAW: "1000000000000000000",
    BNB_LP_AGENT_PUBLIC_URL: "https://agon.surf/api/bnb/97/providers/lp-guardian", ALTANA_SESSION_FILE: "/run/secrets/altana" });
  assert.equal(ready.ready, true);
});

test("intent IDs and LP inputs create deterministic bounded service terms", () => {
  assert.equal(parseCommerceIntentId(intentId.toUpperCase()), intentId);
  assert.throws(() => parseCommerceIntentId("same-request"));
  const result = lpNegotiationRequest(intentId, { positionId: "123", halfWidthSteps: 10, maxDeviationTicks: 100 },
    { serviceVersion: "agon-lp-guardian/1.0.0", registrationHash: `sha256:${"ab".repeat(32)}` });
  assert.equal(result.input.positionId, "123");
  assert.equal(result.request.request_id, intentId);
  assert.match(String(result.request.task_description), /Do not submit a liquidity transaction/);
  assert.match(String(result.request.task_description), /agon-lp-guardian\/1\.0\.0/);
  assert.match(String(result.request.task_description), /sha256:abab/);
});

test("signed quotes must bind exact price, token, chain and commerce contract", () => {
  const envelope = { chain_id: 97, verifying_contract: commerce, negotiation_hash: `0x${"11".repeat(32)}`,
    provider_sig: `0x${"22".repeat(65)}`, response: { accepted: true, quote_expires_at: Math.floor(Date.now() / 1000) + 300,
      terms: { price: "17", currency: token } } };
  assert.equal(signedQuoteFields(envelope, { priceRaw: "17", token, commerce }).priceRaw, "17");
  assert.throws(() => signedQuoteFields({ ...envelope, chain_id: 56 }, { priceRaw: "17", token, commerce }));
  assert.throws(() => signedQuoteFields(envelope, { priceRaw: "18", token, commerce }));
  assert.throws(() => signedQuoteFields({ ...envelope, provider_sig: "" }, { priceRaw: "17", token, commerce }));
  assert.throws(() => signedQuoteFields({ ...envelope, response: { ...envelope.response, quote_expires_at: Math.floor(Date.now() / 1000) + 700 } }, { priceRaw: "17", token, commerce }));
});

test("job expiry preserves the full dispute window plus execution buffer", () => {
  assert.equal(jobExpiry(1_000n, "900"), 1_000n + 900n + LP_EXECUTION_BUFFER_SECONDS);
  assert.throws(() => jobExpiry(1_000n, "0"));
});

test("wallet steps use exact calldata and never attach native value", () => {
  const values = { commerce, router, policy, token, provider, amount: 17n, description: "signed", expiredAt: 5_500n, jobId: 9n };
  const create = preparedTransaction("create", values);
  const decodedCreate = decodeFunctionData({ abi: COMMERCE_WRITE_ABI, data: create.data });
  assert.equal(decodedCreate.functionName, "createJob");
  assert.equal(create.value, "0");
  const approve = preparedTransaction("approve", values);
  const decodedApprove = decodeFunctionData({ abi: erc20Abi, data: approve.data });
  assert.equal(decodedApprove.functionName, "approve");
  assert.deepEqual(decodedApprove.args, [commerce, 17n]);
  const fund = preparedTransaction("fund", values);
  const decodedFund = decodeFunctionData({ abi: COMMERCE_WRITE_ABI, data: fund.data });
  assert.equal(decodedFund.functionName, "fund");
  assert.deepEqual(decodedFund.args, [9n, 17n, "0x"]);
});
