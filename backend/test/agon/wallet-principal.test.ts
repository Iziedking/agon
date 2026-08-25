import test from "node:test";
import assert from "node:assert/strict";
import { walletPrincipalForLinkedCircleWallet, walletPrincipalForOperator } from "../../src/auth/wallet-principal.ts";

test("external operators are explicit user-custodied browser wallets", () => {
  assert.deepEqual(
    walletPrincipalForOperator({ address: "0xABCDEF", circleWalletId: null }),
    {
      address: "0xabcdef",
      mode: "external",
      custody: "user",
      signingSurface: "browser_wallet",
      label: "External wallet",
    },
  );
});

test("legacy email operators are labelled as managed Circle wallets", () => {
  assert.deepEqual(
    walletPrincipalForOperator({ address: "0xABCDEF", circleWalletId: "circle-wallet-1" }),
    {
      address: "0xabcdef",
      mode: "circle_developer_controlled",
      custody: "agon",
      signingSurface: "agon_backend",
      label: "Managed Circle wallet",
    },
  );
});

test("linked Circle user-controlled wallets are explicit user-custodied browser principals", () => {
  assert.deepEqual(
    walletPrincipalForLinkedCircleWallet({ address: "0xABCDEF", principalType: "circle_user_controlled" }),
    {
      address: "0xabcdef",
      mode: "circle_user_controlled",
      custody: "user",
      signingSurface: "browser_circle",
      label: "Circle user-controlled wallet",
    },
  );
});
