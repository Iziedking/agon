import assert from "node:assert/strict";
import test from "node:test";

import { settlementReadinessLabel, settlementReadinessTone } from "./settlement-review.ts";

test("maps settlement states to clear operational labels", () => {
  assert.equal(settlementReadinessLabel("ready_but_disabled"), "READY · ADAPTER OFF");
  assert.equal(settlementReadinessLabel("service_delivery_pending"), "SERVICE DELIVERY PENDING");
  assert.equal(settlementReadinessLabel("reconciliation_required"), "RECONCILIATION REQUIRED");
  assert.equal(settlementReadinessTone("terminal"), "ok");
  assert.equal(settlementReadinessTone("reconciliation_required"), "err");
});
