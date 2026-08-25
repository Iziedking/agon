import assert from "node:assert/strict";
import test from "node:test";

import { scaffoldServiceProject } from "./service-scaffold.ts";

test("scaffold creates a valid service config and fail-closed runtime", () => {
  const scaffold = scaffoldServiceProject({ serviceKey: "code-review", name: "Code Review", category: "development" });
  assert.deepEqual(scaffold.files.map((file) => file.path), ["agon.service.json", "service.ts", "Dockerfile", "README.md"]);
  const config = JSON.parse(scaffold.files[0]!.content) as Record<string, unknown>;
  assert.equal(config.serviceKey, "code-review");
  assert.equal(config.chainId, "5042002");
  assert.match(scaffold.files[1]!.content, /status: \"ready\"/);
  assert.match(scaffold.files[1]!.content, /facilitator_not_configured/);
  assert.match(scaffold.files[1]!.content, /send\(response, 402/);
});

test("scaffold rejects unsafe identifiers", () => {
  assert.throws(() => scaffoldServiceProject({ serviceKey: "../escape", name: "Bad", category: "development" }), /lowercase slug/);
  assert.throws(() => scaffoldServiceProject({ serviceKey: "safe", name: "Bad", category: "development_" }), /lowercase slug/);
});
