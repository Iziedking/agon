import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadAgonDeployment } from "../../src/config/deployments.ts";
import { inspectAgonProtocolReadiness } from "../../src/agon/protocol-readiness.ts";

test("canonical receipt records the external ValidationRegistry and passes the source gate", () => {
  const loaded = loadAgonDeployment("../contracts/deployments/agon-arc-testnet.json");
  assert.ok(loaded.deployment);
  const readiness = inspectAgonProtocolReadiness(loaded.deployment);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missingContracts, []);
  assert.deepEqual(readiness.unverifiedContracts, []);
  assert.equal(readiness.externalRegistry.validation, "0x8004Cb1BF31DAf7788923b405b754f57acEB4272");
  assert.deepEqual(readiness.reasons, []);
});

test("protocol readiness fails closed for a partial receipt", () => {
  const input = JSON.parse(readFileSync(new URL("../../../contracts/deployments/agon-arc-testnet.json", import.meta.url), "utf8"));
  delete input.external.ValidationRegistry;
  delete input.contracts.AgonPrizeVault;
  const readiness = inspectAgonProtocolReadiness(input);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missingContracts.includes("AgonPrizeVault"));
  assert.ok(readiness.reasons.includes("validation_registry_incomplete"));
});

test("a configured V2 registry requires its own source-verification receipt", () => {
  const input = JSON.parse(readFileSync(new URL("../../../contracts/deployments/agon-arc-testnet.json", import.meta.url), "utf8"));
  delete input.sourceVerification.AgonServiceRegistryV2;
  delete input.sourceVerification.AgonArenaV2;
  const readiness = inspectAgonProtocolReadiness(input);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missingContracts, []);
  assert.ok(readiness.unverifiedContracts.includes("AgonServiceRegistryV2"));
  assert.ok(readiness.unverifiedContracts.includes("AgonArenaV2"));
  assert.ok(readiness.reasons.includes("source_verification_incomplete"));
});
