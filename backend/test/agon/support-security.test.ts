import assert from "node:assert/strict";
import test from "node:test";

import { needsHumanSupport, redactSupportMessage } from "../../src/support/core.ts";
import {
  hashOpaqueToken,
  hashSupportPassword,
  normalizeSupportEmail,
  validateSupportPassword,
  verifySupportPassword,
} from "../../src/support/security.ts";

test("support passwords are salted, verified, and reject weak values", async () => {
  assert.match(validateSupportPassword("short") ?? "", /12 characters/);
  assert.match(validateSupportPassword("alllowercase123") ?? "", /uppercase/);
  const first = await hashSupportPassword("A-reliable-passphrase-42");
  const second = await hashSupportPassword("A-reliable-passphrase-42");
  assert.notEqual(first, second);
  assert.equal(await verifySupportPassword("A-reliable-passphrase-42", first), true);
  assert.equal(await verifySupportPassword("wrong-password", first), false);
});

test("support identities and bearer tokens are normalized without storing secrets", () => {
  assert.equal(normalizeSupportEmail("  TEAM@Agon.Surf "), "team@agon.surf");
  assert.equal(hashOpaqueToken("one-time-token").length, 64);
  assert.notEqual(hashOpaqueToken("one-time-token"), "one-time-token");
});

test("assistant redaction removes wallet secrets and escalation detects human-risk cases", () => {
  const key = `0x${"a".repeat(64)}`;
  assert.equal(redactSupportMessage(`my key is ${key}`).includes(key), false);
  assert.equal(needsHumanSupport("I was charged but the service did not run"), true);
  assert.equal(needsHumanSupport("How do I add a square logo?"), false);
});
