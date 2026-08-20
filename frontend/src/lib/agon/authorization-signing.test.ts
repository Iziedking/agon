import assert from "node:assert/strict";
import test from "node:test";

import { getX402SigningGate } from "./authorization-signing.ts";
import type { X402AuthorizationView } from "./types.ts";

const authorization = {
  payload: { message: { from: "0x1111111111111111111111111111111111111111" } },
} as unknown as X402AuthorizationView;

test("fails closed before a wallet can sign", () => {
  assert.equal(getX402SigningGate(authorization, { preview: true, isConnected: false }), "preview_disabled");
  assert.equal(getX402SigningGate(authorization, { preview: false, isConnected: false }), "connect_wallet");
  assert.equal(getX402SigningGate(authorization, { preview: false, isConnected: true, address: authorization.payload.message.from, chainId: 1 }), "switch_chain");
  assert.equal(getX402SigningGate(authorization, { preview: false, isConnected: true, address: "0x2222222222222222222222222222222222222222", chainId: 5042002 }), "wrong_account");
});

test("allows only the exact owner on Arc Testnet", () => {
  assert.equal(getX402SigningGate(authorization, { preview: false, isConnected: true, address: "0x1111111111111111111111111111111111111111", chainId: 5042002 }), "ready");
});
