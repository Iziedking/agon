import assert from "node:assert/strict";
import test from "node:test";
import { CLI_DEVICE_ALPHABET, CLI_USER_CODE_RE, formatCliUserCode, hashCliCode, randomCliCode } from "../../src/auth/cli-device.ts";

test("CLI user codes are readable, fixed-shape, and exclude ambiguous characters", () => {
  const code = formatCliUserCode(randomCliCode(8));
  assert.match(code, CLI_USER_CODE_RE);
  assert.equal(code.length, 9);
  assert.ok([...code.replace("-", "")].every((character) => CLI_DEVICE_ALPHABET.includes(character)));
  assert.ok(!/[01IO]/.test(code));
});

test("CLI code hashing is deterministic and does not expose the raw code", () => {
  const first = hashCliCode("ABCD-EFGH");
  assert.equal(first, hashCliCode("ABCD-EFGH"));
  assert.notEqual(first, hashCliCode("ABCD-EFGI"));
  assert.equal(first.length, 64);
});
