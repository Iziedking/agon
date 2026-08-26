import assert from "node:assert/strict";
import test from "node:test";

import { settlementReadinessLabel, settlementReadinessTone } from "./settlement-review.ts";

test("maps settlement states to clear operational labels", () => {
  assert.equal(settlementReadinessLabel("ready_but_disabled"), "PAYMENT UNAVAILABLE");
  assert.equal(settlementReadinessLabel("service_delivery_pending"), "WAITING FOR SERVICE");
  assert.equal(settlementReadinessLabel("reconciliation_required"), "CHECKING PAYMENT");
  assert.equal(settlementReadinessTone("terminal"), "ok");
  assert.equal(settlementReadinessTone("reconciliation_required"), "err");
});
