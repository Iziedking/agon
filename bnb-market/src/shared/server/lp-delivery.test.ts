import assert from "node:assert/strict";
import { deliveryUrl, lpDeliveryConfig, reconcileSubmittedManifest, reportContent, workerIntervalMs } from "./lp-delivery.ts";

const base: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  BNB_LP_AGENT_EXECUTION_ENABLED: "true",
  BNB_LP_AGENT_DELIVERABLE_BASE_URL: "https://agon.surf/api/bnb/97/providers/lp-guardian/deliverables",
  BNB_LP_AGENT_HIRING_ENABLED: "true", BNB_LP_AGENT_ID: "2114", BNB_LP_AGENT_ADDRESS: "0x0000000000000000000000000000000000000001",
  BNB_LP_AGENT_PRICE_RAW: "1", BNB_LP_AGENT_PUBLIC_URL: "https://agon.surf/api/bnb/97/providers/lp-guardian/erc8183/status",
  BNB_LP_AGENT_HIRE_DAILY_LIMIT: "25", ALTANA_SESSION_FILE: "./session.json",
};

assert.equal(lpDeliveryConfig(base).ready, true);
assert.equal(deliveryUrl(base.BNB_LP_AGENT_DELIVERABLE_BASE_URL!, "7"), `${base.BNB_LP_AGENT_DELIVERABLE_BASE_URL}/7`);
assert.throws(() => deliveryUrl(base.BNB_LP_AGENT_DELIVERABLE_BASE_URL!, "0"));
assert.equal(workerIntervalMs("1000"), 1000);
assert.equal(workerIntervalMs("bad"), 30000);
assert.deepEqual(lpDeliveryConfig({ ...base, BNB_LP_AGENT_EXECUTION_ENABLED: "false" }), { ready: false, blockers: ["execution_flag_disabled"] });
assert.throws(() => reportContent({ chainId: 97, mode: "read_only", decision: { executed: true } } as never));
const hash = `0x${"ab".repeat(32)}`;
assert.equal(reconcileSubmittedManifest(2, hash, hash), "submitted");
assert.equal(reconcileSubmittedManifest(3, hash.toUpperCase(), hash), "submitted");
assert.equal(reconcileSubmittedManifest(2, `0x${"cd".repeat(32)}`, hash), "needs_attention");
assert.equal(reconcileSubmittedManifest(1, hash, hash), null);
console.log("lp delivery tests passed");
