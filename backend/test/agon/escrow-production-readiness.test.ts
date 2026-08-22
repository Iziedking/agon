import assert from "node:assert/strict";
import test from "node:test";
import { AGON_ESCROW_NETWORK, AGON_ESCROW_USDC } from "../../src/agon/escrow-policy.ts";
import { AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES } from "../../src/agon/execution/escrow-transaction-approval.ts";
import { evaluateAgonEscrowProductionReadiness } from "../../src/agon/execution/escrow-production-readiness.ts";

const PROFILE = `0x${"11".repeat(20)}`;
const SERVICE = `0x${"22".repeat(20)}`;
const IDENTITY = `0x${"33".repeat(20)}`;
const ESCROW = `0x${"44".repeat(20)}`;
const CONTROLLER = `0x${"55".repeat(20)}`;
const DEPLOYMENT = {
  chainId: 5_042_002,
  contracts: { AgonProfileRegistry: PROFILE, AgonServiceRegistry: SERVICE, PrizeEscrow: ESCROW },
  external: { IdentityRegistry: { address: IDENTITY, chainId: 5_042_002 } },
};

function readyInput(overrides: Partial<Parameters<typeof evaluateAgonEscrowProductionReadiness>[0]> = {}) {
  return {
    chainId: 5_042_002,
    network: AGON_ESCROW_NETWORK,
    asset: AGON_ESCROW_USDC,
    deployment: DEPLOYMENT,
    controller: CONTROLLER,
    controllerPolicyConfigured: true,
    flags: {
      writesEnabled: true,
      escrowEnabled: true,
      executionEnabled: true,
      preflightEnabled: true,
      writerEnabled: true,
      lifecycleAdapterEnabled: true,
      reconciliationEnabled: true,
    },
    approvalRequired: true,
    approvalPhrases: AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES,
    exactTransactionPlanBound: true,
    signerAvailable: true,
    providerFinalityConfigured: true,
    now: new Date("2026-08-22T12:00:00.000Z"),
    ...overrides,
  };
}

test("default disabled configuration reports every release blocker and never enables execution", () => {
  const result = evaluateAgonEscrowProductionReadiness({
    ...readyInput(),
    deployment: {
      chainId: 5_042_002,
      contracts: { AgonProfileRegistry: PROFILE, AgonServiceRegistry: SERVICE },
      external: DEPLOYMENT.external,
    },
    flags: {
      writesEnabled: false,
      escrowEnabled: false,
      executionEnabled: false,
      preflightEnabled: false,
      writerEnabled: false,
      lifecycleAdapterEnabled: false,
      reconciliationEnabled: false,
    },
    signerAvailable: false,
    providerFinalityConfigured: false,
  });
  assert.equal(result.ready, false);
  assert.equal(result.executionEnabled, false);
  assert.deepEqual(result.reasons, [
    "prize_escrow_not_deployed",
    "writes_flag_disabled",
    "escrow_flag_disabled",
    "execution_flag_disabled",
    "write_preflight_disabled",
    "transaction_writer_disabled",
    "lifecycle_adapter_disabled",
    "reconciliation_flag_disabled",
    "signer_unavailable",
    "provider_finality_not_configured",
  ]);
});

test("canonical Agon receipt is blocked until a PrizeEscrow deployment is added", () => {
  const result = evaluateAgonEscrowProductionReadiness({
    ...readyInput(),
    deployment: {
      chainId: 5_042_002,
      contracts: { AgonProfileRegistry: PROFILE, AgonServiceRegistry: SERVICE },
      external: DEPLOYMENT.external,
    },
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.reasons, ["prize_escrow_not_deployed"]);
});

test("accepts a separately deployed platform PrizeEscrow when explicitly composed", () => {
  const result = evaluateAgonEscrowProductionReadiness({
    ...readyInput(),
    deployment: {
      chainId: 5_042_002,
      contracts: { AgonProfileRegistry: PROFILE, AgonServiceRegistry: SERVICE },
      external: DEPLOYMENT.external,
    },
    prizeEscrowAddress: ESCROW,
  });
  assert.equal(result.reasons.includes("prize_escrow_not_deployed"), false);
  assert.equal(result.ready, true);
});

test("wrong chain and malformed deployment identities fail closed", () => {
  const result = evaluateAgonEscrowProductionReadiness({
    ...readyInput(),
    chainId: 1,
    network: "eip155:1",
    asset: "0x123",
    deployment: {
      chainId: 1,
      contracts: { AgonProfileRegistry: "0x123", AgonServiceRegistry: SERVICE },
      external: { IdentityRegistry: { address: IDENTITY, chainId: 1 } },
    },
    prizeEscrowAddress: "0x123",
    controller: "0x123",
  });
  assert.deepEqual(result.reasons.slice(0, 8), [
    "chain_not_arc_testnet",
    "network_not_arc_testnet",
    "asset_not_arc_testnet_usdc",
    "deployment_chain_mismatch",
    "profile_registry_missing_or_invalid",
    "identity_registry_missing_or_invalid",
    "prize_escrow_not_deployed",
    "escrow_controller_unconfigured",
  ]);
});

test("all gates can be reviewed as ready but the evaluator still cannot enable execution", () => {
  const result = evaluateAgonEscrowProductionReadiness(readyInput());
  assert.equal(result.ready, true);
  assert.equal(result.executionEnabled, false);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.requiredApprovals, []);
});

test("approval phrase drift is surfaced per operation", () => {
  const result = evaluateAgonEscrowProductionReadiness({
    ...readyInput(),
    approvalPhrases: { ...AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES, release: "wrong" },
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.requiredApprovals, ["release"]);
  assert.deepEqual(result.reasons, ["approval_phrase_required"]);
});

test("refuses an inferred controller when explicit policy is absent", () => {
  const result = evaluateAgonEscrowProductionReadiness({
    ...readyInput(),
    controllerPolicyConfigured: false,
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.reasons, ["controller_policy_unconfigured"]);
});
