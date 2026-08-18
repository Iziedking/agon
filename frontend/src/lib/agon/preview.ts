import { canonicalManifestHash } from "./canonical.ts";
import type { AgonCapabilities, AgonHealth, AgonListing } from "./types.ts";

const SERVICE_REGISTRY = "0x2144C156B0a4581da2D046C2E41AC41C6C3938CB";
const PROVIDER = "0x0aeEF0Dd6b0754262d1a91e435565749Cdc365Ad";

const verifiedManifest = {
  name: "Contract Safety Review",
  version: 1,
  description: "Reviews Solidity contracts and returns prioritized findings with reproducible evidence.",
  category: "verification",
  endpoint: "https://security.preview.agon.surf/x402/review",
  tags: ["security", "solidity", "audit"],
  pricing: { rail: "escrow", amountUSDC: "4.00" },
};

const providerManifest = {
  name: "Agon Market Intel",
  version: 1,
  description: "Returns current crypto prediction-market odds and volume data for autonomous research agents.",
  category: "prediction",
  endpoint: "https://api.agon.surf/x402/market-intel",
  tags: ["market-data", "polymarket", "x402"],
  pricing: { rail: "x402", amountUSDC: "0.001" },
};

const quarantinedManifest = {
  name: "Autonomous Treasury Executor",
  version: 2,
  description: "Claims to rebalance treasury positions across protocols without a matching manifest anchor.",
  category: "execution",
  endpoint: "https://unsafe.preview.agon.surf/x402/execute",
  tags: ["execution", "treasury", "high-risk"],
  pricing: { rail: "escrow", amountUSDC: "15.00" },
};

function id(listingId: string) {
  return `5042002:${SERVICE_REGISTRY}:${listingId}`;
}

function txHash(byte: string) {
  return `0x${byte.repeat(64)}`;
}

export const AGON_PREVIEW_LISTINGS: AgonListing[] = [
  {
    id: id("1"),
    chainId: "5042002",
    serviceRegistry: SERVICE_REGISTRY,
    listingId: "1",
    agentId: "880101",
    serviceKey: `0x${"11".repeat(32)}`,
    category: "8",
    version: "1",
    manifest: {
      hash: canonicalManifestHash(verifiedManifest),
      uri: "https://verified.preview.agon.surf/manifest-v1.json",
      body: verifiedManifest,
    },
    providerSnapshot: PROVIDER,
    status: "Listed",
    verification: {
      status: "Verified",
      scope: { agentId: "880101", listingId: "1", version: "1", category: "8" },
    },
    risk: { unverified: false, warning: null, quarantineReason: null },
    payment: { rail: "Escrow", directX402: false, escrowEligible: true },
    provenance: { sourceBlockNumber: "57530001", sourceTxHash: txHash("1"), sourceLogIndex: 0 },
  },
  {
    id: id("2"),
    chainId: "5042002",
    serviceRegistry: SERVICE_REGISTRY,
    listingId: "2",
    agentId: "880102",
    serviceKey: `0x${"22".repeat(32)}`,
    category: "4",
    version: "1",
    manifest: {
      hash: canonicalManifestHash(providerManifest),
      uri: "https://agon.surf/.well-known/agon/market-intel/manifest-v1.json",
      body: providerManifest,
    },
    providerSnapshot: PROVIDER,
    status: "Listed",
    verification: {
      status: "Unverified",
      scope: { agentId: "880102", listingId: "2", version: "1", category: "4" },
    },
    risk: {
      unverified: true,
      warning: "The provider anchored this version, but Agon has not verified its behavior yet.",
      quarantineReason: null,
    },
    payment: { rail: "X402", directX402: true, escrowEligible: false },
    provenance: { sourceBlockNumber: "57530002", sourceTxHash: txHash("2"), sourceLogIndex: 1 },
  },
  {
    id: id("3"),
    chainId: "5042002",
    serviceRegistry: SERVICE_REGISTRY,
    listingId: "3",
    agentId: "880103",
    serviceKey: `0x${"33".repeat(32)}`,
    category: "5",
    version: "2",
    manifest: {
      hash: `0x${"99".repeat(32)}`,
      uri: "https://unsafe.preview.agon.surf/manifest-v2.json",
      body: quarantinedManifest,
    },
    providerSnapshot: PROVIDER,
    status: "Suspended",
    verification: {
      status: "Suspended",
      scope: { agentId: "880103", listingId: "3", version: "2", category: "5" },
    },
    risk: {
      unverified: true,
      warning: "The indexed manifest does not match the onchain hash.",
      quarantineReason: "manifest_hash_mismatch",
    },
    payment: { rail: "Escrow", directX402: false, escrowEligible: false },
    provenance: { sourceBlockNumber: "57530003", sourceTxHash: txHash("3"), sourceLogIndex: 2 },
  },
];

export const AGON_PREVIEW_CAPABILITIES: AgonCapabilities = {
  identityReads: true,
  profileWrites: false,
  listingReads: true,
  listingWrites: false,
  endpointQa: false,
  directX402: true,
  escrow: false,
  writeReadiness: {
    checkedAt: null,
    reasons: ["preview_read_only"],
  },
};

export const AGON_PREVIEW_HEALTH: AgonHealth = {
  ok: true,
  service: "agon",
  capabilities: AGON_PREVIEW_CAPABILITIES,
};

