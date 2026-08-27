"use client";

import { useEffect, useState } from "react";

import { AppHeader } from "@/components/pengu/AppHeader";
import { CornerMarkers } from "@/components/redesign/CornerMarkers";
import { Footer } from "@/components/redesign/Footer";
import { TagButton } from "@/components/redesign/TagButton";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { confirmTx } from "@/lib/arc";
import { AGON_SERVICE_REGISTRY, agonServiceRegistryAbi } from "@/lib/agon/abi";
import { AGON_NETWORK } from "@/lib/agon/network";
import { confirmAgonOperation, inspectManifest, publishListingVersion } from "@/lib/agon/client";
import type { PaymentRail } from "@/lib/agon/types";

type PendingConfirmation = {
  operationId: string;
  txHash: `0x${string}`;
};

const PENDING_CONFIRMATION_KEY = "agon:listing-version:pending-confirmation";

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
  const [published, setPublished] = useState(false);
  const [publishedTxHash, setPublishedTxHash] = useState<`0x${string}` | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const nextListingId = query.get("listingId");
    const nextManifestUri = query.get("manifestUri");
    const nextOperationId = query.get("operationId");
    const nextTxHash = query.get("txHash");
    if (nextListingId) setListingId(nextListingId);
    if (nextManifestUri) setManifestUri(nextManifestUri);
    try {
      if (nextOperationId && /^[0-9a-f-]{36}$/i.test(nextOperationId) && nextTxHash && /^0x[0-9a-fA-F]{64}$/.test(nextTxHash)) {
        const pending = { operationId: nextOperationId, txHash: nextTxHash as `0x${string}` } satisfies PendingConfirmation;
        setPendingConfirmation(pending);
        sessionStorage.setItem(PENDING_CONFIRMATION_KEY, JSON.stringify(pending));
        return;
      }
      const stored = sessionStorage.getItem(PENDING_CONFIRMATION_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as Partial<PendingConfirmation>;
      if (typeof parsed.operationId === "string" && /^0x[0-9a-fA-F]{64}$/.test(parsed.txHash ?? "")) {
        setPendingConfirmation({ operationId: parsed.operationId, txHash: parsed.txHash as `0x${string}` });
      }
    } catch {
      sessionStorage.removeItem(PENDING_CONFIRMATION_KEY);
    }
  }, []);

  async function loadManifest() {
    setLoading(true);
    setNotice(null);
    setError(null);
    try {
      const inspection = await inspectManifest(manifestUri.trim());
      if (!inspection.validation.ok) throw new Error(inspection.validation.message);
      setManifestHash(inspection.manifestHash);
      setNotice(`Manifest loaded and validated. ${inspection.byteLength} bytes. Review the hash, then publish the new immutable version.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the manifest.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmPendingVersion(pending: PendingConfirmation) {
    if (!address || !isSignedIn) {
      setError("Connect the wallet that submitted this transaction.");
      return;
    }
    setPublishing(true);
    setNotice(null);
    setError(null);
    try {
      const confirmed = await confirmAgonOperation(pending.operationId, pending.txHash, address);
      setPublished(true);
      setPublishedTxHash(confirmed.txHash ?? pending.txHash);
      setPendingConfirmation(null);
      sessionStorage.removeItem(PENDING_CONFIRMATION_KEY);
      setNotice(`Version confirmed${confirmed.resultReference ? `: ${confirmed.resultReference}` : "."}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The existing transaction could not be confirmed yet.");
    } finally {
      setPublishing(false);
    }
  }

  async function publishVersion() {
    if (pendingConfirmation) {
      await confirmPendingVersion(pendingConfirmation);
      return;
    }
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
        setPublished(true);
        setPublishedTxHash(operation.txHash ?? null);
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
      const pending = { operationId: operation.operationId, txHash: hash } satisfies PendingConfirmation;
      setPendingConfirmation(pending);
      sessionStorage.setItem(PENDING_CONFIRMATION_KEY, JSON.stringify(pending));
      const confirmed = await confirmAgonOperation(operation.operationId, hash, address);
      setPublished(true);
      setPublishedTxHash(confirmed.txHash ?? hash);
      setPendingConfirmation(null);
      sessionStorage.removeItem(PENDING_CONFIRMATION_KEY);
      setNotice(`Version published${confirmed.resultReference ? `: ${confirmed.resultReference}` : "."}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Version publication failed.");
    } finally {
      setPublishing(false);
    }
  }

  const closed = published;
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-[1180px] px-6 py-16 md:px-10">
        <CornerMarkers />
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-pink">Listing maintenance</p>
        <h1 className="mt-5 max-w-[760px] font-display text-5xl uppercase leading-[0.9] md:text-7xl">Publish a new version</h1>
        <p className="mt-6 max-w-[680px] font-mono text-sm leading-7 text-ink-2">
          Update the manifest behind your service. The current listing stays in place, while this change becomes a new version with its own hash and trust record.
        </p>
        <p className="mt-3 max-w-[680px] font-mono text-[11px] leading-6 text-ink-3">Change the name, price, endpoint, description, tags, or logo in the manifest first. Then load it here and publish once.</p>

        <section className="mt-12 border border-[color:var(--hairline-strong)] p-6 md:p-10">
          <div className="grid gap-6 md:grid-cols-2">
            <label className="font-mono text-xs uppercase tracking-[0.16em] text-ink-2">
              Listing ID
              <input disabled={closed} className={`${INPUT_CLASS} mt-3`} value={listingId} onChange={(event) => setListingId(event.target.value)} inputMode="numeric" />
            </label>
            <label className="font-mono text-xs uppercase tracking-[0.16em] text-ink-2">
              Payment rail
              <select disabled={closed} className={`${INPUT_CLASS} mt-3`} value={paymentRail} onChange={(event) => setPaymentRail(event.target.value as PaymentRail)}>
                <option value="X402">X402</option>
                <option value="Escrow">Escrow</option>
              </select>
            </label>
          </div>
          <label className="mt-6 block font-mono text-xs uppercase tracking-[0.16em] text-ink-2">
            Exact public manifest URL
            <input disabled={closed} className={`${INPUT_CLASS} mt-3`} value={manifestUri} onChange={(event) => { setManifestUri(event.target.value); setManifestHash(""); }} />
          </label>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={loadManifest} disabled={loading || publishing || closed} className="border border-ink px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] disabled:opacity-40">
              {loading ? "READING MANIFEST" : "LOAD MANIFEST"}
            </button>
            {!closed ? <button type="button" onClick={publishVersion} disabled={(!manifestHash && !pendingConfirmation) || publishing || loading} className="bg-pink px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-white disabled:opacity-40">
              {publishing ? (pendingConfirmation ? "CONFIRMING" : "PREPARING") : pendingConfirmation ? "CONFIRM EXISTING TRANSACTION" : "PUBLISH VERSION"}
            </button> : null}
          </div>
          {manifestHash ? <p className="mt-6 break-all font-mono text-xs text-ink-2">Manifest hash: {manifestHash}</p> : null}
          {pendingConfirmation ? <div role="status" className="mt-6 border-l-2 border-[color:var(--warn)] bg-canvas-2 px-4 py-3 font-mono text-xs leading-6 text-[color:var(--warn)]">
            <p>Transaction submitted. Confirm the existing transaction before publishing again.</p>
            <TagButton href={`${AGON_NETWORK.explorerUrl.replace(/\/$/, "")}/tx/${pendingConfirmation.txHash}`} target="_blank" rel="noreferrer" variant="ghost" size="sm">VIEW TRANSACTION</TagButton>
          </div> : null}
          {notice ? <p role="status" className="mt-6 border-l-2 border-[color:var(--ok)] bg-canvas-2 px-4 py-3 font-mono text-xs leading-6 text-[color:var(--ok)]">{notice}</p> : null}
          {error ? <p role="alert" className="mt-6 border-l-2 border-pink bg-pink/10 px-4 py-3 font-mono text-xs leading-6 text-ink">{error}</p> : null}
          {publishedTxHash ? (
            <div className="mt-6 border-l-2 border-[color:var(--ok)] bg-canvas-2 px-4 py-4">
              <p className="font-mono text-xs leading-6 text-[color:var(--ok)]">Version confirmed on Arc Testnet. This action is closed. Publish another version only after changing the manifest.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {publishedTxHash ? <TagButton href={`${AGON_NETWORK.explorerUrl.replace(/\/$/, "")}/tx/${publishedTxHash}`} target="_blank" rel="noreferrer" variant="ghost" size="sm">VIEW TRANSACTION</TagButton> : null}
                <TagButton href="/market" variant="ghost" size="sm">VIEW MARKET</TagButton>
                <TagButton href={`/market/version?listingId=${encodeURIComponent(listingId)}`} variant="ghost" size="sm">START ANOTHER VERSION</TagButton>
              </div>
            </div>
          ) : null}
        </section>
      </main>
      <Footer />
    </>
  );
}
