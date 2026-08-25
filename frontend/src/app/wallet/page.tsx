"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, CornerMarkers, SectionHeader } from "@/components/redesign";
import { FundsPanel } from "@/components/redesign/FundsPanel";
import { useAuth } from "@/hooks/useAuth";

/// Dedicated Top Up / Withdraw page. The dashboard CTAs route here rather than
/// embedding the funds flow inline. `?tab=withdraw` deep-links the withdraw tab.

function WalletBody() {
  const params = useSearchParams();
  const tab = params.get("tab") === "withdraw" ? "withdraw" : "topup";
  const { me } = useAuth();
  return (
    <section className="mx-auto max-w-[1200px] px-4 sm:px-6 py-10">
      {me?.wallet ? (
        <BracketedCell pad="md" className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">WALLET PRINCIPAL</div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
            <div className="font-stencil text-3xl uppercase">{me.wallet.label}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{me.wallet.mode}</div>
          </div>
          <p className="mt-3 max-w-[70ch] font-mono text-[11px] leading-relaxed text-ink-2">
            {me.wallet.custody === "user"
              ? "You control approvals in your connected wallet. Agon cannot sign for this principal."
              : "This legacy email account uses a managed Circle wallet. Agon signs only through the existing wallet execution boundary."}
          </p>
        </BracketedCell>
      ) : null}
      <FundsPanel initialTab={tab} />
    </section>
  );
}

export default function WalletPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <section className="relative mx-auto max-w-[1200px] px-4 sm:px-6 pt-16">
        <CornerMarkers />
        <SectionHeader
          eyebrow={
            <span className="flex items-center gap-3">
              <span aria-hidden className="text-accent">■</span> FUNDS
            </span>
          }
          heading="TOP UP & WITHDRAW"
          subDeck={<>move usdc into your arc balance to play, or send it back out to any supported chain.</>}
        />
      </section>
      <Suspense fallback={null}>
        <WalletBody />
      </Suspense>
      <Footer />
    </div>
  );
}
