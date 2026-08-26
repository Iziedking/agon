import assert from "node:assert/strict";
import test from "node:test";

import { canonicalManifestHash, canonicalizeManifest } from "./canonical.ts";
import {
  AGON_CATEGORIES,
  categoryById,
  listingMatchesQuery,
  presentListing,
} from "./catalog.ts";
import { buildServiceManifest, validateServiceDraft } from "./draft.ts";
import {
  assessListingAssurance,
  canUseEscrow,
  verifyManifestAnchor,
} from "./verify.ts";
import { AGON_PREVIEW_LISTINGS } from "./preview.ts";

const manifest = {
  name: "Review",
  version: 1,
  endpoint: "https://example.com/x",
  tags: ["security", "review"],
  pricing: { rail: "x402", amountUSDC: "1.50" },
};

const listing = {
  id: "5042002:0x1111111111111111111111111111111111111111:7",
  chainId: "5042002",
  serviceRegistry: "0x1111111111111111111111111111111111111111",
  listingId: "7",
  agentId: "42",
  serviceKey: `0x${"22".repeat(32)}`,
  category: "3",
  version: "1",
  manifest: {
    hash: "0xfa2589c10ac9f0ceaca7679b32ff19b8608b36dd4124dd9d88a01009047db884",
    uri: "https://example.com/manifest.json",
  },
  providerSnapshot: "0x3333333333333333333333333333333333333333",
  status: "Listed" as const,
  verification: {
    status: "Verified" as const,
    scope: { agentId: "42", listingId: "7", version: "1", category: "3" },
  },
  risk: { unverified: false, warning: null, quarantineReason: null },
  endpointQa: {
    status: "not_checked" as const,
    checkedAt: null,
    endpointStatus: null,
    evidenceHash: null,
    reason: "Agon has not run endpoint verification for this listing yet.",
    attempts: 0,
    passedAttempts: 0,
    successRate: null,
  },
  payment: { rail: "Escrow" as const, directX402: false, escrowEligible: true },
  provenance: {
    sourceBlockNumber: "9001",
    sourceTxHash: `0x${"44".repeat(32)}`,
    sourceLogIndex: 2,
  },
};

test("canonicalizes manifests deterministically in the browser", () => {
  assert.equal(
    canonicalizeManifest(manifest),
    '{"endpoint":"https://example.com/x","name":"Review","pricing":{"amountUSDC":"1.50","rail":"x402"},"tags":["security","review"],"version":1}',
  );
  assert.equal(
    canonicalManifestHash(manifest),
    "0xfa2589c10ac9f0ceaca7679b32ff19b8608b36dd4124dd9d88a01009047db884",
  );
});

test("reports matching, mismatching, and unavailable manifest proof", () => {
  assert.equal(verifyManifestAnchor(listing.manifest.hash, manifest).state, "match");
  assert.equal(
    verifyManifestAnchor(`0x${"99".repeat(32)}`, manifest).state,
    "mismatch",
  );
  assert.equal(verifyManifestAnchor(listing.manifest.hash).state, "unavailable");
});

test("detects stale ownership before granting verified assurance", () => {
  const proof = verifyManifestAnchor(listing.manifest.hash, manifest);
  assert.equal(
    assessListingAssurance(
      listing,
      proof,
      "0x5555555555555555555555555555555555555555",
    ).state,
    "stale_ownership",
  );
  assert.equal(canUseEscrow(listing, proof, listing.providerSnapshot), true);
  assert.equal(
    canUseEscrow(listing, proof, "0x5555555555555555555555555555555555555555"),
    false,
  );
});

test("keeps unverified and quarantined listings escrow-ineligible", () => {
  const proof = verifyManifestAnchor(listing.manifest.hash, manifest);
  const unverified = {
    ...listing,
    verification: { ...listing.verification, status: "Unverified" as const },
    risk: { unverified: true, warning: "Not verified", quarantineReason: null },
    payment: { ...listing.payment, escrowEligible: false },
  };
  const quarantined = {
    ...listing,
    risk: { unverified: true, warning: "Anchor mismatch", quarantineReason: "manifest_hash_mismatch" },
  };

  assert.equal(assessListingAssurance(unverified, proof).state, "unverified");
  assert.equal(assessListingAssurance(quarantined, proof).state, "quarantined");
  assert.equal(canUseEscrow(unverified, proof), false);
  assert.equal(canUseEscrow(quarantined, proof), false);
});

test("preview fixtures expose verified, provider-listed, quarantined, and direct-x402 records", () => {
  assert.equal(AGON_PREVIEW_LISTINGS.length, 4);
  assert.equal(AGON_PREVIEW_LISTINGS.filter((item) => item.verification.status === "Verified").length, 2);
  assert.equal(AGON_PREVIEW_LISTINGS.filter((item) => item.risk.unverified && !item.risk.quarantineReason).length, 1);
  assert.equal(AGON_PREVIEW_LISTINGS.filter((item) => Boolean(item.risk.quarantineReason)).length, 1);

  const verified = AGON_PREVIEW_LISTINGS.find((item) => item.verification.status === "Verified");
  assert.ok(verified);
  assert.equal(verifyManifestAnchor(verified.manifest.hash, verified.manifest.body).state, "match");

  const directX402 = AGON_PREVIEW_LISTINGS.find((item) => item.payment.directX402 && item.verification.status === "Verified");
  assert.ok(directX402);
  assert.equal(directX402.endpointQa.status, "passed");

  const quarantined = AGON_PREVIEW_LISTINGS.find((item) => Boolean(item.risk.quarantineReason));
  assert.ok(quarantined);
  assert.equal(verifyManifestAnchor(quarantined.manifest.hash, quarantined.manifest.body).state, "mismatch");
});

test("maps protocol category ids to plain marketplace language", () => {
  assert.equal(AGON_CATEGORIES.length, 9);
  assert.deepEqual(
    AGON_CATEGORIES.map(({ id, slug }) => [id, slug]),
    [
      ["1", "research"],
      ["2", "market-data"],
      ["3", "analysis"],
      ["4", "prediction"],
      ["5", "execution"],
      ["6", "content"],
      ["7", "development"],
      ["8", "verification"],
      ["9", "general"],
    ],
  );
  assert.equal(categoryById("3").label, "Analysis");
  assert.equal(categoryById("47").label, "Other service");
  assert.equal(categoryById("47").id, "47");
});

test("presents indexed manifest details and honest fallbacks", () => {
  const richListing = {
    ...listing,
    manifest: {
      ...listing.manifest,
      body: {
        name: "Protocol security review",
        description: "Reviews smart contracts and returns prioritized findings.",
        logoUrl: "https://example.com/logo.png",
        endpoint: "https://example.com/review",
        tags: ["security", "solidity"],
        pricing: { rail: "x402", amountUSDC: "12.50" },
      },
    },
  };

  assert.deepEqual(presentListing(richListing), {
    name: "Protocol security review",
    description: "Reviews smart contracts and returns prioritized findings.",
    logoUrl: "https://example.com/logo.png",
    category: categoryById("3"),
    tags: ["security", "solidity"],
    endpoint: "https://example.com/review",
    amountUSDC: "12.50",
    hasIndexedManifest: true,
  });
  assert.equal(presentListing(listing).name, "Analysis service");
  assert.match(presentListing(listing).description, /manifest details are not indexed/i);
  assert.equal(listingMatchesQuery(richListing, "solidity"), true);
  assert.equal(listingMatchesQuery(richListing, "agent 42"), true);
  assert.equal(listingMatchesQuery(richListing, "translation"), false);
});

test("builds the browser manifest from user-facing service fields", () => {
  const draft = {
    agentId: "42",
    name: "Protocol security review",
    description: "Reviews smart contracts and returns prioritized findings.",
    logoUrl: "https://example.com/logo.png",
    categoryId: "8",
    serviceKey: "protocol-security-review",
    endpoint: "https://example.com/review",
    tags: "security, solidity",
    amountUSDC: "12.50",
  };

  assert.deepEqual(validateServiceDraft(draft), []);
  assert.deepEqual(buildServiceManifest(draft), {
    name: "Protocol security review",
    version: 1,
    description: "Reviews smart contracts and returns prioritized findings.",
    logoUrl: "https://example.com/logo.png",
    category: "verification",
    endpoint: "https://example.com/review",
    tags: ["security", "solidity"],
    pricing: { rail: "x402", amountUSDC: "12.50" },
  });
  assert.deepEqual(
    validateServiceDraft({ ...draft, categoryId: "47", endpoint: "http://localhost:3000" }),
    [
      { field: "categoryId", message: "Choose one of the marketplace categories." },
      { field: "endpoint", message: "Service endpoint must be a public HTTPS URL." },
    ],
  );
});
