import assert from "node:assert/strict";
import test from "node:test";
import type { PublicClient } from "viem";
import type { AgonDeployment } from "../../src/config/deployments.ts";
import { inspectAgonReadiness } from "../../src/agon/write/readiness.ts";

const PROFILE = "0x1111111111111111111111111111111111111111";
const SERVICE = "0x2222222222222222222222222222222222222222";
const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const deployment: AgonDeployment = {
  chainId: 5_042_002,
  contracts: { AgonProfileRegistry: PROFILE, AgonServiceRegistry: SERVICE },
  external: { IdentityRegistry: { address: IDENTITY, chainId: 5_042_002 } },
};

function client(overrides: Record<string, unknown> = {}) {
  return {
    getChainId: async () => 5_042_002,
    getBytecode: async () => "0x6000",
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "identityRegistry" ? IDENTITY : PROFILE,
    ...overrides,
  } as unknown as Pick<PublicClient, "getChainId" | "getBytecode" | "readContract">;
}

test("stays disabled without the explicit write flag", async () => {
  const result = await inspectAgonReadiness({
    enabled: false,
    configuredChainId: 5_042_002,
    deployment,
    client: client(),
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.reasons, ["writes_disabled"]);
});

test("requires a parsed canonical deployment", async () => {
  const result = await inspectAgonReadiness({
    enabled: true,
    configuredChainId: 5_042_002,
    deployment: null,
    client: client(),
  });
  assert.deepEqual(result.reasons, ["deployment_unavailable"]);
});

test("passes only when chain, code, and registry links agree", async () => {
  const result = await inspectAgonReadiness({
    enabled: true,
    configuredChainId: 5_042_002,
    deployment,
    client: client(),
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.reasons, []);
});

test("reports wrong RPC chain, missing code, and wrong links", async () => {
  const result = await inspectAgonReadiness({
    enabled: true,
    configuredChainId: 1,
    deployment,
    client: client({
      getChainId: async () => 8453,
      getBytecode: async ({ address }: { address: string }) => address === PROFILE ? "0x" : undefined,
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "identityRegistry"
          ? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          : "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }),
  });
  assert.deepEqual(result.reasons, [
    "configured_chain_mismatch",
    "rpc_chain_mismatch",
    "profile_code_missing",
    "service_code_missing",
    "identity_registry_mismatch",
    "profile_registry_link_mismatch",
  ]);
});

test("fails closed when the RPC cannot answer", async () => {
  const result = await inspectAgonReadiness({
    enabled: true,
    configuredChainId: 5_042_002,
    deployment,
    client: client({ getChainId: async () => { throw new Error("offline"); } }),
  });
  assert.deepEqual(result.reasons, ["rpc_unavailable"]);
});

