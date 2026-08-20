import { keccak256, stringToHex } from "viem";
import { publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { canonicalManifestHash, validateManifest } from "./core/manifest.js";

const listingAbi = [{
  type: "function", name: "getListing", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }],
  outputs: [{ type: "tuple", components: [
    { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "string" },
    { type: "uint256" }, { type: "uint8" }, { type: "uint256" }, { type: "address" }, { type: "uint8" },
    { type: "uint8" }, { type: "uint64" }, { type: "uint64" },
  ] }],
}] as const;
const identityAbi = [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] }] as const;

export type AgonVerificationEvidence = {
  listingId: string; agentId: string; checkedAt: string; passed: boolean;
  checks: Record<string, { passed: boolean; detail: string }>;
  manifestHash?: string; endpointStatus?: number; endpointUrl?: string; error?: string;
};

async function httpCheck(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  return { status: response.status, body: await response.text() };
}

export async function verifyAgonListing(listingId: bigint): Promise<AgonVerificationEvidence> {
  const checkedAt = new Date().toISOString();
  const checks: AgonVerificationEvidence["checks"] = {};
  const deployment = config.agon.deployment;
  if (!deployment) throw new Error("Agon deployment is not configured");
  try {
    const listing = await publicClient.readContract({ address: deployment.contracts.AgonServiceRegistry, abi: listingAbi, functionName: "getListing", args: [listingId] });
    const agentId = listing[1];
    const owner = await publicClient.readContract({ address: deployment.external.IdentityRegistry.address, abi: identityAbi, functionName: "ownerOf", args: [agentId] });
    checks.ownership = { passed: owner.toLowerCase() === listing[8].toLowerCase(), detail: `identity owner ${owner}; provider snapshot ${listing[8]}` };
    const manifestResponse = await httpCheck(listing[4]);
    let manifest: unknown = null;
    try { manifest = JSON.parse(manifestResponse.body); } catch { /* recorded below */ }
    const shape = validateManifest(manifest);
    checks.manifest_https = { passed: listing[4].startsWith("https://") && manifestResponse.status === 200, detail: `manifest HTTP ${manifestResponse.status}` };
    checks.manifest_schema = { passed: shape.ok, detail: shape.ok ? "schema accepted" : shape.message };
    const hash = manifest ? canonicalManifestHash(manifest) : "";
    checks.manifest_hash = { passed: hash.toLowerCase() === listing[3].toLowerCase(), detail: `computed ${hash || "unavailable"}; onchain ${listing[3]}` };
    const endpoint = manifest && typeof manifest === "object" && typeof (manifest as Record<string, unknown>).endpoint === "string" ? String((manifest as Record<string, unknown>).endpoint) : "";
    const endpointResponse = endpoint ? await httpCheck(endpoint) : { status: 0, body: "" };
    checks.endpoint_https = { passed: endpoint.startsWith("https://"), detail: endpoint || "missing endpoint" };
    checks.x402_payment = { passed: endpointResponse.status === 402, detail: `endpoint HTTP ${endpointResponse.status}` };
    checks.category = { passed: listing[5] > 0n, detail: `category ${listing[5]}` };
    checks.service_key = { passed: listing[2] !== "0x" + "0".repeat(64), detail: listing[2] };
    const passed = Object.values(checks).every((c) => c.passed);
    return { listingId: listingId.toString(), agentId: agentId.toString(), checkedAt, passed, checks, manifestHash: hash || undefined, endpointStatus: endpointResponse.status, endpointUrl: endpoint || undefined };
  } catch (error) {
    return { listingId: listingId.toString(), agentId: "", checkedAt, passed: false, checks, error: error instanceof Error ? error.message : String(error) };
  }
}

export function verificationEvidenceHash(evidence: AgonVerificationEvidence): `0x${string}` {
  return keccak256(stringToHex(JSON.stringify(evidence)));
}
