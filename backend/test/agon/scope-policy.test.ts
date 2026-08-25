import assert from "node:assert/strict";
import test from "node:test";
import { canUseAgonScope } from "../../src/auth/scope-policy.ts";

test("CLI tokens need the exact requested capability", () => {
  assert.equal(canUseAgonScope({ client: "agon-cli", scopes: ["listing:write"] }, "listing:write"), true);
  assert.equal(canUseAgonScope({ client: "agon-cli", scopes: ["agon:read"] }, "listing:write"), false);
});

test("browser sessions remain compatible with existing routes", () => {
  assert.equal(canUseAgonScope({ client: null, scopes: [] }, "listing:write"), true);
});
