"use client";

import { useEffect } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, SectionHeader, TagButton } from "@/components/redesign";

/// Route-level error boundary for /bridge. Next.js renders this when any
/// component inside the segment throws during render or in an async path.
/// Most commonly this fires when a wallet rejection bubbles out of the
/// Circle Bridge Kit promise chain after our local catch has already
/// returned. Replaces the generic white "Application error" page with a
/// recovery card the user can act on.

export default function BridgeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the underlying error in dev so we can still see what tripped.
    if (typeof window !== "undefined") {
      console.warn("[bridge] caught error:", error.message, error.digest);
    }
  }, [error]);

  const friendly = (() => {
    const m = (error.message ?? "").toLowerCase();
    if (m.includes("user rejected") || m.includes("user denied") || m.includes("declined")) {
      return "You declined the request in your wallet. Nothing was sent.";
    }
    if (m.includes("cannot find module") || m.includes("bridge_sdk_missing")) {
      return "Bridge SDK is not installed yet. Run npm install @circle-fin/app-kit @circle-fin/adapter-viem-v2 in the frontend and reload.";
    }
    if (m.includes("network") && m.includes("switch")) {
      return "Wallet network switch did not complete. Try switching manually and reload.";
    }
    return "Something went sideways in the bridge flow. Your wallet is fine; no funds moved beyond what already settled on chain.";
  })();

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <section className="mx-auto w-full max-w-[1200px] px-6 py-16">
        <SectionHeader
          eyebrow={<span><span aria-hidden className="text-accent">■</span> BRIDGE PAUSED</span>}
          heading="HEADS UP"
          subDeck={<>the bridge flow hit something it could not handle. your funds are safe.</>}
        />
        <BracketedCell pad="lg" className="mt-8 flex flex-col gap-4">
          <p className="font-mono text-sm leading-[1.55] text-ink-2">{friendly}</p>
          <div className="flex flex-wrap items-center gap-3">
            <TagButton onClick={reset}>TRY AGAIN</TagButton>
            <TagButton variant="ghost" href="/dashboard">BACK TO DASHBOARD</TagButton>
          </div>
          {error.digest ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              error ref · {error.digest}
            </p>
          ) : null}
        </BracketedCell>
      </section>
      <Footer />
    </div>
  );
}
