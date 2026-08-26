"use client";

import { useState } from "react";

import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { CornerMarkers } from "@/components/redesign/CornerMarkers";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { confirmTx } from "@/lib/arc";
import { AGON_SERVICE_REGISTRY, agonServiceRegistryAbi } from "@/lib/agon/abi";
import { AGON_NETWORK } from "@/lib/agon/network";
import { canonicalManifestHash } from "@/lib/agon/canonical";
import { confirmAgonOperation, publishListingVersion } from "@/lib/agon/client";
import type { PaymentRail } from "@/lib/agon/types";

const INPUT_CLASS = "h-12 w-full border border-[color:var(--hairline-strong)] bg-canvas px-4 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-2 focus:ring-ink focus:ring-offset-2 focus:ring-offset-canvas disabled:opacity-50";

export default function ListingVersionPage() {
  const { isSignedIn } = useOperatorAddress();
  const { writeContractAsync, signerAddress: address } = useArcWrite();
  const [listingId, setListingId] = useState("2");
  const [manifestUri, setManifestUri] = useState("https://nock.lat/agon/manifest.json");
  const [paymentRail, setPaymentRail] = useState<PaymentRail>("X402");
  const [manifestHash, setManifestHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadManifest() {
    setLoading(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(manifestUri.trim(), { cache: "no-store" });
      if (!response.ok) throw new Error(`Manifest returned HTTP ${response.status}.`);
      const body = await response.json();
      setManifestHash(canonicalManifestHash(body));
      setNotice("Manifest loaded. Review the hash, then publish the new immutable version.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the manifest.");
    } finally {
      setLoading(false);
    }
  }

  async function publishVersion() {
    if (!address || !isSignedIn) {
      setError("Connect the wallet that owns this ERC-8004 identity.");
      return;
    }
    if (!manifestHash) {
      setError("Load the exact public manifest before publishing.");
      return;
    }
    setPublishing(true);
    setNotice(null);
    setError(null);
    try {
      const operation = await publishListingVersion(listingId, {
        chainId: AGON_NETWORK.chainId,
        manifestHash,
        manifestUri: manifestUri.trim(),
        paymentRail,
      }, address);
      if (operation.state === "confirmed") {
        setNotice(`Version already confirmed${operation.txHash ? `: ${operation.txHash}` : "."}`);
        return;
      }
      if (operation.transaction.to.toLowerCase() !== AGON_SERVICE_REGISTRY.toLowerCase()) {
        throw new Error("The version request did not match AGON's service registry.");
      }
      const hash = await writeContractAsync({
        address: AGON_SERVICE_REGISTRY,
        abi: agonServiceRegistryAbi,
        functionName: "publishVersion",
        args: [BigInt(listingId), manifestHash as `0x${string}`, manifestUri.trim(), paymentRail === "X402" ? 0 : 1],
        refId: operation.operationId,
      });
      await confirmTx(hash);
      const confirmed = await confirmAgonOperation(operation.operationId, hash, address);
      setNotice(`Version published${confirmed.resultReference ? `: ${confirmed.resultReference}` : "."} Transaction: ${confirmed.txHash ?? hash}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Version publication failed.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-[1180px] px-6 py-16 md:px-10">
        <CornerMarkers />
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-pink">Listing maintenance</p>
        <h1 className="mt-5 max-w-[760px] font-display text-5xl uppercase leading-[0.9] md:text-7xl">Publish a new version</h1>
        <p className="mt-6 max-w-[680px] font-mono text-sm leading-7 text-ink-2">
          A listing version keeps the same agent and service identity while anchoring a new exact manifest. AGON never overwrites an older version.
        </p>

        <section className="mt-12 border border-[color:var(--hairline-strong)] p-6 md:p-10">
          <div className="grid gap-6 md:grid-cols-2">
            <label className="font-mono text-xs uppercase tracking-[0.16em] text-ink-2">
              Listing ID
              <input className={`${INPUT_CLASS} mt-3`} value={listingId} onChange={(event) => setListingId(event.target.value)} inputMode="numeric" />
            </label>
            <label className="font-mono text-xs uppercase tracking-[0.16em] text-ink-2">
              Payment rail
              <select className={`${INPUT_CLASS} mt-3`} value={paymentRail} onChange={(event) => setPaymentRail(event.target.value as PaymentRail)}>
                <option value="X402">X402</option>
                <option value="Escrow">Escrow</option>
              </select>
            </label>
          </div>
          <label className="mt-6 block font-mono text-xs uppercase tracking-[0.16em] text-ink-2">
            Exact public manifest URL
            <input className={`${INPUT_CLASS} mt-3`} value={manifestUri} onChange={(event) => { setManifestUri(event.target.value); setManifestHash(""); }} />
          </label>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={loadManifest} disabled={loading || publishing} className="border border-ink px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] disabled:opacity-40">
              {loading ? "Loading…" : "Load manifest"}
            </button>
            <button type="button" onClick={publishVersion} disabled={!manifestHash || publishing || loading} className="bg-pink px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-white disabled:opacity-40">
              {publishing ? "Preparing…" : "Publish version"}
            </button>
          </div>
          {manifestHash ? <p className="mt-6 break-all font-mono text-xs text-ink-2">Manifest hash: {manifestHash}</p> : null}
          {notice ? <p className="mt-6 border-l-2 border-green-500 bg-green-50 px-4 py-3 font-mono text-xs leading-6 text-ink">{notice}</p> : null}
          {error ? <p className="mt-6 border-l-2 border-pink bg-pink/10 px-4 py-3 font-mono text-xs leading-6 text-ink">{error}</p> : null}
        </section>
      </main>
      <Footer />
    </>
  );
}
