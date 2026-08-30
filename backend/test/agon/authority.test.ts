import assert from "node:assert/strict";
import test from "node:test";
import { AGON_AUTHORITIES, AGON_AUTHORITY_ACTIONS, authoritiesFor, authorityCanPerform } from "../../src/agon/authority.ts";

test("keeps protocol authorities separate by action", () => {
  assert.deepEqual(authoritiesFor("bind_identity"), ["user_wallet"]);
  assert.deepEqual(authoritiesFor("publish_listing"), ["user_wallet"]);
  assert.deepEqual(authoritiesFor("certify_listing"), ["certifier_wallet"]);
  assert.deepEqual(authoritiesFor("resolve_dispute"), ["resolver"]);
  assert.deepEqual(authoritiesFor("receive_fee"), ["treasury"]);
  assert.deepEqual(authoritiesFor("invoke_service"), ["user_wallet", "agent_wallet"]);
});

test("does not allow one wallet role to substitute for another", () => {
  for (const authority of AGON_AUTHORITIES) {
    for (const action of AGON_AUTHORITY_ACTIONS) {
      const expected = authoritiesFor(action).includes(authority);
      assert.equal(authorityCanPerform(authority, action), expected, `${authority}:${action}`);
    }
  }
  assert.equal(authorityCanPerform("agent_wallet", "publish_listing"), false);
  assert.equal(authorityCanPerform("certifier_wallet", "resolve_dispute"), false);
  assert.equal(authorityCanPerform("treasury", "certify_listing"), false);
});
