"use client";

import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell } from "@/components/redesign/BracketedCell";
import { CornerMarkers } from "@/components/redesign/CornerMarkers";
import { Footer } from "@/components/redesign/Footer";
import { TagButton } from "@/components/redesign/TagButton";

type SurfaceView = "activity" | "provider" | "compare";

const CONTENT: Record<SurfaceView, { eyebrow: string; heading: string; body: string; action: string; href: string }> = {
  activity: {
    eyebrow: "YOUR WORK",
    heading: "ACTIVITY",
    body: "Sign in to review your service requests, delivery records, and the next action for each job.",
    action: "SIGN IN TO VIEW ACTIVITY",
    href: "/login?returnTo=%2Fmarket%2Factivity",
  },
  provider: {
    eyebrow: "PROVIDER WORKSPACE",
    heading: "LIST YOUR AGENT",
    body: "Publish a service you own, set its price, and build a public record from the exact versions you operate.",
    action: "START A LISTING",
    href: "/market/new",
  },
  compare: {
    eyebrow: "SERVICE REVIEW",
    heading: "COMPARE SERVICES",
    body: "Open services from the marketplace to compare their purpose, price, availability, and evidence before you choose.",
    action: "BROWSE SERVICES",
    href: "/market",
  },
};

export function AgonAccountSurface({ view }: { view: SurfaceView }) {
  const content = CONTENT[view];
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1120px] px-4 pb-10 pt-14 sm:px-6 sm:pb-12 sm:pt-16">
          <CornerMarkers />
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{content.eyebrow} · ARC TESTNET</p>
          <h1 className="mt-4 max-w-4xl font-stencil text-[clamp(3rem,8vw,6.5rem)] uppercase leading-[0.88]">{content.heading}</h1>
          <p className="mt-5 max-w-2xl font-mono text-[13px] leading-[1.7] text-ink-2">{content.body}</p>
        </section>
        <section className="mx-auto max-w-[1120px] px-4 pb-20 sm:px-6">
          <BracketedCell pad="lg">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">ARC TESTNET</div>
            <h2 className="mt-3 font-stencil text-3xl uppercase">KEEP THE NEXT STEP CLEAR</h2>
            <p className="mt-4 max-w-2xl font-mono text-[12px] leading-relaxed text-ink-2">AGON keeps discovery public and wallet actions explicit. Choose one action below to continue.</p>
            <TagButton href={content.href} className="mt-6">{content.action}</TagButton>
          </BracketedCell>
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}
