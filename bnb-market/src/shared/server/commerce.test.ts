import { test } from "node:test";
import assert from "node:assert/strict";
import { exactTokenAmount, contractBlockers, providerBlockers, jobState, receiptJobId } from "./commerce-core.ts";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { COMMERCE_EVENTS, decodeCommerceEvents } from "./commerce.ts";

const address = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
function logTopics(values: readonly (Hex | Hex[] | null)[]): Hex[] {
  return values.map((value) => {
    if (typeof value !== "string") throw new Error("Receipt topics must be concrete, not event-query filters.");
    return value;
  });
}
const healthy = { codePresent: true, bindingsMatch: true, whitelisted: true, paused: false, tokenMatches: true, disputeWindow: "900", quorum: 1, voters: 2 };
test("unsafe JSON numeric prices cannot become a payable amount", () => {
  assert.equal(exactTokenAmount("1000000000000000000"), "1000000000000000000");
  assert.equal(exactTokenAmount(1000000000000000000), null);
  for (const value of [-1, "-1", "1e18", "01", "1.1", null, (2n ** 256n).toString()]) assert.equal(exactTokenAmount(value), null);
});
test("missing bytecode, wrong bindings, revoked policy and pauses fail closed", () => {
  assert.deepEqual(contractBlockers(healthy), []);
  for (const change of [{ codePresent: false }, { bindingsMatch: false }, { whitelisted: false }, { paused: true }, { tokenMatches: false }, { quorum: 0 }, { voters: 0 }, { disputeWindow: "0" }]) assert.ok(contractBlockers({ ...healthy, ...change }).length);
});
test("provider status cannot override deployment, wallet or payment token", () => {
  const expected = { commerce: address, router: address, policy: address, token: address, wallet: address };
  const card = { status: "ok", agent_address: address, commerce_address: address, router_address: address, policy_address: address, payment_token: address };
  assert.deepEqual(providerBlockers(card, expected, true), []);
  for (const field of ["agent_address", "commerce_address", "router_address", "policy_address", "payment_token"]) assert.ok(providerBlockers({ ...card, [field]: other }, expected, true).length);
  assert.ok(providerBlockers(card, expected, false).includes("provider_policy_not_whitelisted"));
});
test("submitted is not completed, expiry eligibility is not a refund receipt", () => {
  assert.equal(jobState(2), "submitted");
  assert.equal(jobState(3), "completed");
  assert.equal(jobState(5), "expired");
  assert.throws(() => jobState(6));
});
test("a hash and successful receipt alone cannot establish a job", () => {
  assert.throws(() => receiptJobId([], address));
  assert.throws(() => receiptJobId([{ address: other, jobId: 1n }], address));
  assert.throws(() => receiptJobId([{ address, jobId: 1n }, { address, jobId: 2n }], address));
  assert.equal(receiptJobId([{ address, jobId: 1n }, { address, jobId: 1n }], address), "1");
});
test("receipt decoder ignores forged emitter and preserves exact payment amount", () => {
  const topics = encodeEventTopics({ abi: COMMERCE_EVENTS, eventName: "PaymentReleased", args: { jobId: 17n, provider: other } });
  const data = encodeAbiParameters([{ type: "uint256" }], [1000000000000000001n]);
  const events = decodeCommerceEvents([{ address, topics: logTopics(topics), data }, { address: other, topics: logTopics(topics), data }], address);
  assert.equal(events.length, 1);
  assert.equal(events[0].amountRaw, "1000000000000000001");
  assert.equal(events[0].event, "PaymentReleased");
  assert.equal(receiptJobId(events, address), "17");
});
test("creation and funding events remain distinct from settlement", () => {
  const topics = encodeEventTopics({ abi: COMMERCE_EVENTS, eventName: "JobFunded", args: { jobId: 18n, client: address, provider: other } });
  const data = encodeAbiParameters([{ type: "uint256" }], [0n]);
  const events = decodeCommerceEvents([{ address, topics: logTopics(topics), data }], address);
  assert.equal(events[0].event, "JobFunded");
  assert.equal(events[0].amountRaw, "0");
});
