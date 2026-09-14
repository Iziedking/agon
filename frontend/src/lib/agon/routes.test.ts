import assert from "node:assert/strict";
import test from "node:test";

import { isAgonRoute, isLegacyArcRunRoute, isPublicMarketplaceDocsRoute } from "./routes.ts";

test("legacy ArcRun routes stay outside Agon route family", () => {
  assert.equal(isLegacyArcRunRoute("/app"), true);
  assert.equal(isLegacyArcRunRoute("/contests/42"), true);
  assert.equal(isLegacyArcRunRoute("/bridge"), true);
  assert.equal(isLegacyArcRunRoute("/market"), false);
});

test("Agon route family contains discovery and protected Agon surfaces", () => {
  assert.equal(isAgonRoute("/"), true);
  assert.equal(isAgonRoute("/market/123"), true);
  assert.equal(isAgonRoute("/agon/playground"), true);
  assert.equal(isAgonRoute("/docs/list-agents"), true);
  assert.equal(isAgonRoute("/app"), false);
});

test("only marketplace documentation routes are public", () => {
  assert.equal(isPublicMarketplaceDocsRoute("/docs"), true);
  assert.equal(isPublicMarketplaceDocsRoute("/docs/list-agents"), true);
  assert.equal(isPublicMarketplaceDocsRoute("/docs/internal"), false);
  assert.equal(isPublicMarketplaceDocsRoute("/docs/api"), false);
});
