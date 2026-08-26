import assert from "node:assert/strict";
import test from "node:test";

import { selectAgonSigner } from "./wallet-principal.ts";

const operator = "0xA045e8104bc066fFf5Bfc673Abf354871EDc03c5";
const linkedCircle = "0x3Bafa3a0987699391A2003c3Aa06D41B0209c397";

test("uses the active linked Circle wallet as the exact Agon signer", () => {
  assert.deepEqual(selectAgonSigner({
    walletKind: "circle",
    sessionAddress: operator,
    connectedAddress: operator,
    activeCircleUserControlledAddress: linkedCircle,
    linkedPrincipalAddresses: [linkedCircle],
  }), {
    address: linkedCircle.toLowerCase(),
    route: "circle_user_controlled",
  });
});

test("does not accept an active Circle wallet that is not linked to the session", () => {
  assert.deepEqual(selectAgonSigner({
    walletKind: "circle",
    sessionAddress: operator,
    connectedAddress: operator,
    activeCircleUserControlledAddress: linkedCircle,
    linkedPrincipalAddresses: [],
  }), {
    address: operator.toLowerCase(),
    route: "circle_developer_controlled",
  });
});
