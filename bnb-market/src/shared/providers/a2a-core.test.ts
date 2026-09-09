import test from "node:test";
import assert from "node:assert/strict";
import { blockProvenance, buildTaskRequest, parseA2ACard, parseA2AOutcome } from "./a2a-core.ts";

const KEEL_URL = "https://marque.trade/agents/keel/.well-known/agent-card.json";
// Captured verbatim from the live Keel card on 2026-09-09.
const keel = {
  name: "Keel", url: "https://marque.trade/agents/keel/a2a", protocolVersion: "0.3.0",
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ["text/plain", "application/json"], defaultOutputModes: ["application/json"],
  skills: [
    { id: "health-factor-read", name: "Read a Venus health factor", description: "Health factor to three decimals." },
    { id: "repay-to-target", name: "Exact repayment to restore a target health factor", description: "Closed-form USD repayment." },
  ],
};

test("a live agent card yields its declared endpoint and skills", () => {
  const card = parseA2ACard(keel, KEEL_URL);
  assert.equal(card.name, "Keel");
  assert.equal(card.endpoint, "https://marque.trade/agents/keel/a2a");
  assert.equal(card.protocolVersion, "0.3.0");
  assert.equal(card.streaming, false);
  assert.deepEqual(card.skills.map((skill) => skill.id), ["health-factor-read", "repay-to-target"]);
});

test("a card cannot redirect a buyer to another host", () => {
  assert.throws(() => parseA2ACard({ ...keel, url: "https://evil.example/a2a" }, KEEL_URL), /different host/);
  assert.throws(() => parseA2ACard({ ...keel, url: "http://marque.trade/agents/keel/a2a" }, KEEL_URL), /HTTPS/);
});

test("a card with nothing runnable is refused, not shown as usable", () => {
  assert.throws(() => parseA2ACard({ ...keel, skills: [] }, KEEL_URL), /no skills/);
  assert.throws(() => parseA2ACard({ ...keel, skills: [{ name: "no id" }] }, KEEL_URL), /no identifiable skill/);
  assert.throws(() => parseA2ACard({ ...keel, name: "" }, KEEL_URL), /does not name/);
  assert.throws(() => parseA2ACard("not an object", KEEL_URL), /not a JSON object/);
});

test("the task request is a valid A2A message/send carrying the run id", () => {
  const body = buildTaskRequest("run-1", "read the health factor");
  assert.equal(body.method, "message/send");
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, "run-1");
  assert.equal(body.params.message.parts[0].text, "read the health factor");
  assert.equal(body.params.message.role, "user");
});

test("a completed read surfaces the provider text and its stated block", () => {
  // Captured verbatim from Keel on 2026-09-09.
  const outcome = parseA2AOutcome({ jsonrpc: "2.0", id: "probe-2", result: { kind: "task", status: { state: "completed" },
    artifacts: [{ parts: [{ kind: "text", text: '{"healthFactor":null,"note":"this account carries no debt, so it has no health factor","blockNumber":"120894769"}' }] }] } });
  assert.equal(outcome.state, "completed");
  assert.equal(outcome.blockNumber, "120894769");
  assert.match(outcome.artifacts[0], /carries no debt/);
  assert.doesNotMatch(outcome.message, /verified/i);
});

test("an agent asking for more detail is a real answer, not a marketplace failure", () => {
  // Captured verbatim from Sluicegate on 2026-09-09.
  const outcome = parseA2AOutcome({ jsonrpc: "2.0", id: "probe-3", result: { kind: "task", status: { state: "completed" },
    artifacts: [{ parts: [{ kind: "text", text: '{"error":"the task does not state the asset","need":"net APR is size-dependent"}' }] }] } });
  assert.equal(outcome.state, "completed");
  assert.match(outcome.artifacts[0], /size-dependent/);
  const asked = parseA2AOutcome({ result: { status: { state: "input-required" } } });
  assert.equal(asked.state, "input_required");
  assert.match(asked.message, /needs more detail/);
});

test("a declared failure or JSON-RPC error is reported as the provider's own refusal", () => {
  const declined = parseA2AOutcome({ result: { status: { state: "failed" }, artifacts: [{ parts: [{ kind: "text", text: "out of scope" }] }] } });
  assert.equal(declined.state, "failed");
  assert.match(declined.message, /declined/);
  const errored = parseA2AOutcome({ jsonrpc: "2.0", id: "1", error: { code: -32602, message: "Invalid params" } });
  assert.equal(errored.state, "failed");
  assert.equal(errored.message, "Invalid params");
});

test("a malformed envelope or invented block height is refused", () => {
  assert.throws(() => parseA2AOutcome({ jsonrpc: "2.0", id: "1" }), /no result/);
  assert.throws(() => parseA2AOutcome(null), /invalid response/);
  const noBlock = parseA2AOutcome({ result: { status: { state: "completed" },
    artifacts: [{ parts: [{ kind: "text", text: '{"blockNumber":"not-a-number"}' }] }] } });
  assert.equal(noBlock.blockNumber, null);
  const empty = parseA2AOutcome({ result: { status: { state: "completed" }, artifacts: [] } });
  assert.match(empty.message, /without any readable output/);
});

test("a stated block consistent with the selected chain is reported as such", () => {
  // LP Guardian read chain 97 at 130068251 while the head was 130068795.
  const provenance = blockProvenance("130068251", 97, "130068795", "120923975");
  assert.equal(provenance.verdict, "matches_selected");
  assert.match(provenance.message, /consistent with BSC Testnet/);
});

test("an agent reading the other chain is named, not silently displayed", () => {
  // Keel is registered on chain 97 but answered with BSC Mainnet heights.
  const provenance = blockProvenance("120923909", 97, "130068795", "120923975");
  assert.equal(provenance.verdict, "matches_other_chain");
  assert.match(provenance.message, /matches BSC Mainnet, not the BSC Testnet listing/);
  assert.match(provenance.message, /different chain from its registration/);
});

test("an unanchored or impossible block height is never presented as chain data", () => {
  assert.equal(blockProvenance(null, 97, "130068795", "120923975").verdict, "not_stated");
  assert.equal(blockProvenance("1", 97, "130068795", "120923975").verdict, "outside_both");
  // A block far beyond both heads cannot have been read.
  assert.equal(blockProvenance("999999999999", 97, "130068795", "120923975").verdict, "outside_both");
  // With no head available, nothing is confirmed.
  assert.equal(blockProvenance("130068251", 97, null, null).verdict, "outside_both");
});

test("a stale read inside the window still counts, a very stale one does not", () => {
  assert.equal(blockProvenance("130000000", 97, "130068795", null).verdict, "matches_selected");
  assert.equal(blockProvenance("129000000", 97, "130068795", null).verdict, "outside_both");
});
