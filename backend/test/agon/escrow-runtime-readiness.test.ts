import assert from "node:assert/strict";
import test from "node:test";
import { AGON_ESCROW_NETWORK, AGON_ESCROW_USDC } from "../../src/agon/escrow-policy.ts";
import { evaluateAgonEscrowRuntimeReadiness } from "../../src/agon/execution/escrow-runtime-readiness.ts";

const CONTRACT = `0x${"11".repeat(20)}`;
const CONTROLLER = `0x${"22".repeat(20)}`;

test("default runtime readiness reports every disabled gate without external calls", () => {
  const result = evaluateAgonEscrowRuntimeReadiness({
    network: AGON_ESCROW_NETWORK,
    asset: AGON_ESCROW_USDC,
    escrowAddress: CONTRACT,
    controller: CONTROLLER,
    executionEnabled: false,
    preflightEnabled: false,
    writerEnabled: false,
    lifecycleAdapterEnabled: false,
    signerAvailable: false,
    now: new Date("2026-08-22T12:00:00.000Z"),
  });
  assert.equal(result.ready, false);
  assert.equal(result.executionEnabled, false);
  assert.deepEqual(result.reasons, [
    "execution_flag_disabled",
    "write_preflight_disabled",
    "transaction_writer_disabled",
    "lifecycle_adapter_disabled",
    "signer_unavailable",
  ]);
});

test("readiness fails closed for wrong network, asset, and malformed identities", () => {
  const result = evaluateAgonEscrowRuntimeReadiness({
    network: "eip155:1",
    asset: "0x123",
    escrowAddress: "0x123",
    controller: null,
    executionEnabled: true,
    preflightEnabled: true,
    writerEnabled: true,
    lifecycleAdapterEnabled: true,
    signerAvailable: true,
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.reasons, [
    "network_not_arc_testnet",
    "asset_not_arc_testnet_usdc",
    "escrow_contract_unconfigured_or_invalid",
    "controller_unconfigured_or_invalid",
  ]);
});

test("all gates can be reviewed as ready while execution remains explicitly disabled", () => {
  const result = evaluateAgonEscrowRuntimeReadiness({
    network: AGON_ESCROW_NETWORK,
    asset: AGON_ESCROW_USDC,
    escrowAddress: CONTRACT,
    controller: CONTROLLER,
    executionEnabled: true,
    preflightEnabled: true,
    writerEnabled: true,
    lifecycleAdapterEnabled: true,
    signerAvailable: true,
  });
  assert.equal(result.ready, true);
  assert.equal(result.executionEnabled, false);
  assert.deepEqual(result.reasons, []);
});

