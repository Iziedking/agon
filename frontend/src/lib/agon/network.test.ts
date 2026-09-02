import assert from "node:assert/strict";
import test from "node:test";

import {
  AGON_DEFAULT_NETWORK_KEY,
  AGON_NETWORKS,
  getAgonNetworkKey,
  networkHref,
} from "./network.ts";

test("BNB Mainnet is the Agon default context", () => {
  assert.equal(AGON_DEFAULT_NETWORK_KEY, "bnb-mainnet");
  assert.equal(AGON_NETWORKS[AGON_DEFAULT_NETWORK_KEY].chainId, 56);
  assert.equal(AGON_NETWORKS[AGON_DEFAULT_NETWORK_KEY].brand, "BNB");
});

test("the supported network registry keeps all three chain identities distinct", () => {
  assert.equal(AGON_NETWORKS["bnb-mainnet"].chainId, 56);
  assert.equal(AGON_NETWORKS["bnb-testnet"].chainId, 97);
  assert.equal(AGON_NETWORKS["arc-testnet"].chainId, 5042002);
  assert.equal(AGON_NETWORKS["bnb-mainnet"].explorerUrl, "https://bscscan.com");
  assert.equal(AGON_NETWORKS["bnb-testnet"].explorerUrl, "https://testnet.bscscan.com");
  assert.equal(AGON_NETWORKS["arc-testnet"].explorerUrl, "https://testnet.arcscan.app");
});

test("unconfigured BNB contexts cannot inherit the Arc catalog adapter", () => {
  assert.equal(AGON_NETWORKS["bnb-mainnet"].apiUrl, null);
  assert.equal(AGON_NETWORKS["bnb-testnet"].apiUrl, null);
  assert.equal(AGON_NETWORKS["bnb-mainnet"].readiness, "adapter_pending");
  assert.equal(AGON_NETWORKS["bnb-testnet"].readiness, "adapter_pending");
  assert.equal(AGON_NETWORKS["arc-testnet"].apiUrl !== null, true);
});

test("network links preserve the route and replace only the network context", () => {
  assert.equal(
    networkHref("/market", "bnb-testnet", "?category=trading&network=arc-testnet"),
    "/market?category=trading&network=bnb-testnet",
  );
  assert.equal(getAgonNetworkKey("not-a-network"), "bnb-mainnet");
});
