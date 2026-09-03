import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_COMPARE_SERVICES,
  addCompareId,
  parseCompareIds,
  removeCompareId,
  serializeCompareIds,
} from "./compare-core.ts";

test("compare ids are stable, deduplicated, and bounded", () => {
  assert.deepEqual(parseCompareIds(" first, second,first,third,fourth "), ["first", "second", "third"]);
  assert.equal(MAX_COMPARE_SERVICES, 3);
});

test("compare ids round-trip without changing order", () => {
  assert.equal(serializeCompareIds(["agent-b", "agent-a", "agent-b"]), "agent-b,agent-a");
});

test("compare selection can add and remove without mutating input", () => {
  const original = ["agent-a"];
  const selected = addCompareId(original, "agent-b");
  assert.deepEqual(original, ["agent-a"]);
  assert.deepEqual(selected, ["agent-a", "agent-b"]);
  assert.deepEqual(removeCompareId(selected, "agent-a"), ["agent-b"]);
});
