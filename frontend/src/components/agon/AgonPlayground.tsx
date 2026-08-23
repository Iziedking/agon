"use client";

import { useMemo, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell, CornerMarkers, SectionHeader, StatusChip, TagButton } from "@/components/redesign";

const DEFAULT_REQUEST = JSON.stringify(
  {
    input: {
      question: "Summarize the latest Arc liquidity risk signals",
      format: "brief",
    },
    caller: "playground-review",
  },
  null,
  2,
);

const CHECKS = [
  ["IDENTITY", "ERC-8004 anchor present", "ok"],
  ["MANIFEST", "Version 1.4.0 is inspectable", "ok"],
  ["ENDPOINT", "HTTPS endpoint declared", "ok"],
  ["PAYMENT", "x402 / USDC rail declared", "warn"],
] as const;

/**
 * AGON's signed-in test surface. This is intentionally a review playground,
 * not a payment button: it validates a request shape locally and makes the
 * execution boundary visible before a provider or wallet is involved.
 */
export function AgonPlayground() {
  const [request, setRequest] = useState(DEFAULT_REQUEST);
  const [inspection, setInspection] = useState<"idle" | "passed" | "failed">("idle");

  const parsed = useMemo(() => {
    try {
      return JSON.parse(request) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [request]);

  function inspectRequest() {
    setInspection(parsed ? "passed" : "failed");
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1280px] px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20">
          <CornerMarkers />
          <SectionHeader
            eyebrow="AGON PLAYGROUND / LOCAL REVIEW"
            heading="TEST THE WORK"
            subDeck="Shape a request, inspect the evidence, and see exactly what would be required before an agent call can leave the browser. This surface never sends a provider request or payment."
            right={<TagButton href="/market" variant="ghost" size="sm">BROWSE SERVICES</TagButton>}
            size="hero"
          />
        </section>

        <section className="border-y border-[color:var(--hairline)] bg-canvas-2">
          <div className="mx-auto grid max-w-[1280px] gap-px bg-[color:var(--hairline)] md:grid-cols-3">
            <PlaygroundSignal index="01" title="CHOOSE A CAPABILITY" body="Start from one versioned service record, not an unscoped agent name." />
            <PlaygroundSignal index="02" title="SHAPE THE INPUT" body="Edit the request body and keep the exact payload visible for review." />
            <PlaygroundSignal index="03" title="READ THE BOUNDARY" body="A passing inspection is not execution. Provider calls remain disabled here." />
          </div>
        </section>

        <section className="mx-auto grid max-w-[1280px] gap-5 px-4 py-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:py-16">
          <BracketedCell tone="ink" pad="lg">
            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.15em] text-[color:var(--card-ink-fg)]/70">
              <span>SELECTED SERVICE</span>
              <span className="inline-flex items-center gap-2 text-[color:var(--card-ink-fg)]"><span aria-hidden className="text-[color:var(--ok)]">●</span> PROVIDER LISTED</span>
            </div>
            <h2 className="mt-12 font-stencil text-[clamp(2.4rem,6vw,5rem)] uppercase leading-[0.88]">RESEARCH<br />DESK</h2>
            <p className="mt-6 max-w-[34ch] font-mono text-sm leading-[1.65] text-[color:var(--card-ink-fg)]/75">
              Agent #42 reads live market signals and returns a concise, source-aware brief.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-px bg-[color:var(--card-ink-fg)]/20">
              <Readout label="VERSION" value="1.4.0" />
              <Readout label="PRICE" value="0.01 USDC" />
              <Readout label="RAIL" value="X402" />
            </div>
            <TagButton href="/market" variant="ghost" size="sm" className="mt-8">OPEN LISTING</TagButton>
          </BracketedCell>

          <BracketedCell pad="lg">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">REQUEST BUILDER</div>
                <h2 className="mt-2 font-stencil text-3xl uppercase leading-none sm:text-4xl">SEND A SHAPE</h2>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">JSON / LOCAL</span>
            </div>
            <label className="mt-8 block">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">INPUT PAYLOAD</span>
              <textarea
                value={request}
                onChange={(event) => { setRequest(event.target.value); setInspection("idle"); }}
                spellCheck={false}
                rows={11}
                className="w-full resize-y border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 py-3 font-mono text-[12px] leading-[1.6] text-ink outline-none transition-colors focus:border-ink focus:ring-2 focus:ring-ink focus:ring-offset-2 focus:ring-offset-canvas"
                aria-label="Playground JSON input"
              />
            </label>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <TagButton onClick={inspectRequest}>INSPECT PAYLOAD</TagButton>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">NO PROVIDER CALL</span>
            </div>
            {inspection === "failed" ? <p role="alert" className="mt-4 font-mono text-[11px] text-[color:var(--err)]">INPUT IS NOT VALID JSON. NOTHING WAS SENT.</p> : null}
            {inspection === "passed" ? <p role="status" className="mt-4 font-mono text-[11px] text-[color:var(--ok)]">PAYLOAD SHAPE ACCEPTED FOR REVIEW. EXECUTION REMAINS OFF.</p> : null}
          </BracketedCell>
        </section>

        <section className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">EVIDENCE READOUT</div>
              <h2 className="mt-2 font-stencil text-4xl uppercase leading-none sm:text-5xl">WHAT AGON CAN PROVE</h2>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">ONE VERSION / ONE REVIEW</span>
          </div>
          <div className="grid gap-px bg-[color:var(--hairline)] sm:grid-cols-2 lg:grid-cols-4">
            {CHECKS.map(([label, detail, tone]) => (
              <div key={label} className="bg-canvas-2 p-5">
                <StatusChip tone={tone}>{label}</StatusChip>
                <p className="mt-4 font-mono text-[11px] leading-[1.6] text-ink-2">{detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 border-l-2 border-accent pl-4 font-mono text-[11px] leading-[1.65] text-ink-2">
            Review is the product boundary. A successful local inspection does not claim provider delivery, payment finality, or onchain execution.
          </div>
        </section>
      </main>
    </div>
  );
}

function PlaygroundSignal({ index, title, body }: { index: string; title: string; body: string }) {
  return (
    <div className="bg-canvas-2 p-5 sm:p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">{index}</div>
      <h2 className="mt-10 font-stencil text-2xl uppercase leading-[0.95]">{title}</h2>
      <p className="mt-4 font-mono text-[11px] leading-[1.65] text-ink-2">{body}</p>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[color:var(--card-ink-bg)] px-3 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--card-ink-fg)]/55">{label}</div>
      <div className="mt-1 font-mono text-[11px] text-[color:var(--card-ink-fg)]">{value}</div>
    </div>
  );
}
