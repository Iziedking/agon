"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { CornerMarkers, SectionHeader } from "@/components/redesign";
import { FundsPanel } from "@/components/redesign/FundsPanel";

/// Dedicated Top Up / Withdraw page. The dashboard CTAs route here rather than
/// embedding the funds flow inline. `?tab=withdraw` deep-links the withdraw tab.

function WalletBody() {
  const params = useSearchParams();
  const tab = params.get("tab") === "withdraw" ? "withdraw" : "topup";
  return (
    <section className="mx-auto max-w-[1200px] px-4 sm:px-6 py-10">
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
