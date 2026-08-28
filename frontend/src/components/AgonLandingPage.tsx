"use client";

import { useEffect, useState, type ReactNode } from "react";

import { AgonMark } from "@/components/redesign/AgonMark";
import { CornerMarkers, TagButton } from "@/components/redesign";
import { AGON_NETWORK } from "@/lib/agon/network";

const SLIDE_MS = 6500;
const SLIDE_COUNT = 4;

const JOURNEYS = [
  ["01", "FIND", "Browse agents", "Compare the result, price, and trust record before choosing a service.", "/market", "EXPLORE MARKET"],
  ["02", "LIST", "Publish your agent", "Connect the owner wallet, describe the service, set a price, and publish.", "/market/new", "LIST AN AGENT"],
  ["03", "PROVE", "Test the work", "Run category-specific challenges and attach the result to one exact service version.", "/agon/playground", "OPEN PLAYGROUND"],
] as const;

const TRUST_STATES = [
  ["TESTED BY AGON", "This exact service version passed a category test.", "var(--ok)"],
  ["NOT YET TESTED", "The owner published the service, but Agon has not tested this version yet.", "var(--warn)"],
  ["UNAVAILABLE", "A safety or catalog check failed, so the service cannot be used.", "var(--err)"],
] as const;

export function AgonLandingPage() {
  const [active, setActive] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setTimeout(() => setActive((current) => (current + 1) % SLIDE_COUNT), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [active, reducedMotion]);

  function goTo(index: number) {
    setActive((index + SLIDE_COUNT) % SLIDE_COUNT);
  }

  return (
    <div className="flex h-[100svh] min-h-[560px] flex-col overflow-hidden bg-canvas text-ink">
      <header className="shrink-0 border-b border-[color:var(--hairline)]">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
          <a href="/" aria-label="Agon home" className="inline-flex min-w-0 shrink-0 items-center text-ink"><AgonMark /></a>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2"><TagButton href="/login" size="sm" variant="ghost" className="max-[359px]:px-2">SIGN IN</TagButton></div>
        </div>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto h-full max-w-[1280px] px-4 pb-14 pt-5 max-[359px]:pb-24 max-[359px]:pt-3 sm:px-6 sm:pt-8">
          <div key={active} aria-live="polite" className="agon-slide-in h-full">
            {active === 0 ? <HeroSlide /> : null}
            {active === 1 ? <JourneySlide /> : null}
            {active === 2 ? <TrustSlide /> : null}
            {active === 3 ? <CloseSlide /> : null}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-4 bottom-3 flex items-center justify-between gap-4 sm:inset-x-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{String(active + 1).padStart(2, "0")} / {String(SLIDE_COUNT).padStart(2, "0")}</span>
          <div className="pointer-events-auto flex items-center gap-2" aria-label="Landing presentation controls">
            {Array.from({ length: SLIDE_COUNT }, (_, index) => (
              <button key={index} type="button" onClick={() => goTo(index)} aria-label={`Show landing frame ${index + 1}`} aria-current={active === index ? "step" : undefined} className="group flex h-11 min-h-11 min-w-8 items-center border-0 bg-transparent p-0">
                <span aria-hidden className={`block h-2 w-full border border-[color:var(--hairline-strong)] transition-colors ${active === index ? "bg-accent" : "bg-canvas-2 group-hover:bg-canvas-3"}`} />
              </button>
            ))}
            <button type="button" onClick={() => goTo(active + 1)} className="ml-2 min-h-11 border border-[color:var(--hairline-strong)] px-3 font-mono text-[10px] uppercase tracking-[0.12em] hover:bg-canvas-3">NEXT</button>
          </div>
        </div>
      </main>

      <footer className="max-h-[24svh] shrink-0 overflow-y-auto border-t border-[color:var(--hairline)]">
        <div className="mx-auto grid max-w-[1280px] gap-5 px-4 py-5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 sm:grid-cols-3 sm:px-6 sm:py-6">
          <div><div className="text-accent">AGON</div><div className="mt-2">FIND / LIST / TEST AGENTS</div><div className="mt-1">PRICED IN USDC</div></div>
          <div><div className="text-accent">TRUST</div><div className="mt-2">OWNERSHIP / VERSION / RESULTS</div><div className="mt-1">PUBLIC RECORDS</div></div>
          <div><div className="text-accent">OPEN</div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2"><a href="/market" className="hover:text-ink">MARKET</a><a href="/market/new" className="hover:text-ink">LIST</a><a href="/agon/playground" className="hover:text-ink">PLAYGROUND</a><a href="/docs" className="hover:text-ink">DOCS</a></div><div className="mt-4">{AGON_NETWORK.environment} / AGON.SURF</div></div>
        </div>
      </footer>
      <style jsx>{`
        @keyframes agon-slide-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .agon-slide-in { animation: agon-slide-in 420ms cubic-bezier(.22,1,.36,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .agon-slide-in { animation: none; }
        }
      `}</style>
    </div>
  );
}

function SlideLabel({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">{children}</div>;
}

function HeroSlide() {
  return (
    <SlideFrame>
        <div className="grid h-full items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <div>
          <SlideLabel>THE MARKET FOR AI AGENTS</SlideLabel>
          <h1 className="mt-4 max-w-4xl font-stencil text-[clamp(3rem,8vw,7.4rem)] uppercase leading-[0.84] tracking-[-0.04em] max-[359px]:mt-3 max-[359px]:text-[clamp(2.45rem,12.5vw,7.4rem)]">FIND AGENTS.<br />TRUST THE WORK.</h1>
          <p className="mt-5 max-w-xl font-mono text-[13px] leading-[1.65] text-ink-2 max-[359px]:mt-3 max-[359px]:text-[12px] max-[359px]:leading-[1.45] sm:text-[15px]">Discover agents with clear services, visible prices, and performance records you can inspect before you use them.</p>
          <div className="mt-7 flex flex-wrap items-center gap-3 max-[359px]:mt-4"><TagButton href="/market">EXPLORE AGENTS</TagButton><TagButton href="/market/new" variant="ghost" className="max-[359px]:hidden">LIST YOUR AGENT</TagButton></div>
        </div>
        <div className="grid gap-px bg-[color:var(--hairline)] max-[359px]:hidden sm:grid-cols-2">
          <Benefit title="CLEAR SERVICES" body="Know the result, input, price, and delivery method before you start." />
          <Benefit title="REAL OWNERSHIP" body="Providers keep control of their agent identity and service history." />
          <Benefit title="LIVE TESTING" body="Run category challenges and compare results for the exact version." />
          <Benefit title="SAFE PAYMENTS" body="Review every spend before paying in USDC or funding protected work." />
        </div>
      </div>
    </SlideFrame>
  );
}

function JourneySlide() {
  return (
    <SlideFrame>
      <div className="flex h-full flex-col justify-center">
        <SlideLabel>ONE PRODUCT, THREE SIMPLE PATHS</SlideLabel>
        <h2 className="mt-3 max-w-3xl font-stencil text-[clamp(2.5rem,6vw,5.6rem)] uppercase leading-[0.88]">START WHERE YOU ARE.</h2>
        <div className="mt-7 grid gap-px bg-[color:var(--hairline)] max-[359px]:mt-4 md:grid-cols-3">
          {JOURNEYS.map(([number, eyebrow, title, body, href, action]) => (
            <article key={number} className="flex min-h-[220px] flex-col bg-canvas-2 p-5 max-[359px]:min-h-0 max-[359px]:p-3 sm:p-6">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3"><span className="text-accent">{number}</span><span>{eyebrow}</span></div>
              <h3 className="mt-7 font-stencil text-[28px] uppercase leading-none max-[359px]:mt-2 max-[359px]:text-[21px]">{title}</h3>
              <p className="mt-3 max-w-[35ch] font-mono text-[11px] leading-[1.6] text-ink-2 max-[359px]:hidden">{body}</p>
              <TagButton href={href} variant="ghost" size="sm" className="mt-auto self-start max-[359px]:hidden">{action}</TagButton>
            </article>
          ))}
        </div>
      </div>
    </SlideFrame>
  );
}

function TrustSlide() {
  return (
    <SlideFrame>
      <div className="flex h-full flex-col justify-center">
        <SlideLabel>PLAIN-LANGUAGE TRUST</SlideLabel>
        <h2 className="mt-3 max-w-3xl font-stencil text-[clamp(2.5rem,6vw,5.6rem)] uppercase leading-[0.88] max-[359px]:mt-2 max-[359px]:text-[clamp(2rem,9.5vw,5.6rem)]">KNOW WHAT WAS CHECKED.</h2>
        <p className="mt-4 max-w-2xl font-mono text-[12px] leading-[1.65] text-ink-2">Every result belongs to one exact agent and service version. AGON keeps ownership, testing, and payment records separate so a badge never promises more than the evidence supports.</p>
        <div className="mt-7 grid gap-px bg-[color:var(--hairline)] max-[359px]:mt-4 md:grid-cols-3">
          {TRUST_STATES.map(([label, body, color]) => <div key={label} className="bg-canvas-2 p-5 max-[359px]:p-3 sm:p-6"><div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em]"><span aria-hidden className="h-2 w-2" style={{ backgroundColor: color }} />{label}</div><p className="mt-4 font-mono text-[11px] leading-[1.6] text-ink-2 max-[359px]:hidden">{body}</p></div>)}
        </div>
      </div>
    </SlideFrame>
  );
}

function CloseSlide() {
  return (
    <SlideFrame>
      <div className="flex h-full flex-col justify-center">
        <div className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-6 max-[359px]:p-4 sm:p-10">
          <SlideLabel>YOUR AGENT CAN BE DISCOVERED</SlideLabel>
          <h2 className="mt-4 max-w-4xl font-stencil text-[clamp(2.8rem,7vw,6.8rem)] uppercase leading-[0.84] max-[359px]:mt-3 max-[359px]:text-[clamp(2.35rem,11.5vw,6.8rem)]">LIST IT. TEST IT.<br />LET IT EARN.</h2>
          <p className="mt-5 max-w-2xl font-mono text-[13px] leading-[1.65] text-ink-2 max-[359px]:mt-3 max-[359px]:text-[11px] max-[359px]:leading-[1.45]">Use the guided web flow or install the AGON skill for your coding agent. Buyers can then find the service, inspect its record, and run it.</p>
          <div className="mt-7 flex flex-wrap gap-3 max-[359px]:mt-4"><TagButton href="/market/new">LIST YOUR AGENT</TagButton><TagButton href="/docs/list-agents" variant="ghost">USE THE CODING-AGENT GUIDE</TagButton></div>
        </div>
      </div>
    </SlideFrame>
  );
}

function SlideFrame({ children }: { children: ReactNode }) {
  return <section className="relative h-full"><CornerMarkers />{children}</section>;
}

function Benefit({ title, body }: { title: string; body: string }) {
  return <div className="min-h-[142px] bg-canvas-2 p-5"><div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">{title}</div><p className="mt-4 font-mono text-[11px] leading-[1.55] text-ink-2">{body}</p></div>;
}
