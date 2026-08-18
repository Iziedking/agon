import { canonicalManifestHash } from "./canonical.ts";
import type { AgonListing } from "./types.ts";

export type ManifestProof =
  | { state: "match"; recomputedHash: string; message: string }
  | { state: "mismatch"; recomputedHash: string; message: string }
  | { state: "invalid"; recomputedHash: null; message: string }
  | { state: "unavailable"; recomputedHash: null; message: string };

export type ListingAssurance = {
  state: "verified" | "unverified" | "quarantined" | "manifest_mismatch" | "stale_ownership";
  label: string;
  message: string;
};

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function verifyManifestAnchor(anchoredHash: string, manifest?: unknown): ManifestProof {
  if (manifest === undefined) {
    return {
      state: "unavailable",
      recomputedHash: null,
      message: "The indexer has not supplied a manifest body for local recomputation.",
    };
  }
  try {
    const recomputedHash = canonicalManifestHash(manifest);
    return sameHex(anchoredHash, recomputedHash)
      ? { state: "match", recomputedHash, message: "Canonical manifest hash matches the onchain anchor." }
      : { state: "mismatch", recomputedHash, message: "Canonical manifest hash does not match the onchain anchor." };
  } catch (error) {
    return {
      state: "invalid",
      recomputedHash: null,
      message: error instanceof Error ? error.message : "Manifest could not be canonicalized.",
    };
  }
}

export function assessListingAssurance(
  listing: AgonListing,
  proof: ManifestProof,
  currentOwner?: string | null,
): ListingAssurance {
  if (listing.risk.quarantineReason) {
    return {
      state: "quarantined",
      label: "QUARANTINED",
      message: listing.risk.warning ?? `Indexer quarantine: ${listing.risk.quarantineReason}`,
    };
  }
  if (proof.state === "mismatch" || proof.state === "invalid") {
    return { state: "manifest_mismatch", label: "ANCHOR MISMATCH", message: proof.message };
  }
  if (currentOwner && !sameHex(currentOwner, listing.providerSnapshot)) {
    return {
      state: "stale_ownership",
      label: "STALE OWNERSHIP",
      message: "The current ERC-8004 owner differs from the provider captured by this listing version.",
    };
  }
  if (listing.verification.status === "Verified") {
    return {
      state: "verified",
      label: "VERIFIED",
      message:
        proof.state === "match"
          ? "The verification scope and locally recomputed manifest anchor agree."
          : "Agon verification is current; local hash recomputation awaits a manifest body from the indexer.",
    };
  }
  return {
    state: "unverified",
    label: listing.verification.status.toUpperCase(),
    message: listing.risk.warning ?? "This service has not passed Agon Arena verification.",
  };
}

export function canUseEscrow(
  listing: AgonListing,
  proof: ManifestProof,
  currentOwner?: string | null,
): boolean {
  return (
    listing.payment.escrowEligible &&
    assessListingAssurance(listing, proof, currentOwner).state === "verified"
  );
}
