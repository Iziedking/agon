"use client";

import { useEffect, useState, type ReactNode } from "react";

import { AgonMark } from "@/components/redesign/AgonMark";
import { CornerMarkers, TagButton } from "@/components/redesign";
import { AGON_NETWORK } from "@/lib/agon/network";

const SLIDE_MS = 6500;
const SLIDE_COUNT = 4;
const STARTUP_STORAGE_KEY = "agon-startup-seen-v1";
const STARTUP_HOLD_MS = 3000;
const STARTUP_EXIT_MS = 680;

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
  const [startupPhase, setStartupPhase] = useState<"visible" | "exiting" | "hidden">("visible");
  const [startupReady, setStartupReady] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const seen = (() => {
      try {
        return window.sessionStorage.getItem(STARTUP_STORAGE_KEY) === "1";
      } catch {
        return false;
      }
    })();

    if (seen) {
      setStartupPhase("hidden");
      return;
    }

    if (media.matches) {
      setStartupReady(true);
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(STARTUP_STORAGE_KEY, "1");
      } catch {
        // The intro can still complete when storage is unavailable.
      }
      setStartupReady(true);
    }, STARTUP_HOLD_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion || startupPhase !== "hidden") return;
    const timer = window.setTimeout(() => setActive((current) => (current + 1) % SLIDE_COUNT), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [active, reducedMotion, startupPhase]);

  function goTo(index: number) {
    setActive((index + SLIDE_COUNT) % SLIDE_COUNT);
  }

  function skipStartup() {
    try {
      window.sessionStorage.setItem(STARTUP_STORAGE_KEY, "1");
    } catch {
      // The intro remains dismissible when storage is unavailable.
    }
    setStartupPhase("exiting");
    window.setTimeout(() => setStartupPhase("hidden"), STARTUP_EXIT_MS);
  }

  return (
    <>
      {startupPhase !== "hidden" ? <StartupIntro phase={startupPhase} ready={startupReady} onEnter={skipStartup} /> : null}
      <div aria-hidden={startupPhase !== "hidden"} className={`flex h-[100svh] min-h-[560px] min-w-0 flex-col overflow-hidden bg-canvas text-ink transition-opacity duration-500 ${startupPhase === "hidden" ? "visible opacity-100" : "pointer-events-none invisible opacity-0"}`}>
      <header className="shrink-0 border-b border-[color:var(--hairline)]">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
          <a href="/" aria-label="Agon home" className="inline-flex min-w-0 shrink-0 items-center text-ink"><AgonMark /></a>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2"><TagButton href="/login" size="sm" variant="ghost" className="max-[359px]:px-2">SIGN IN</TagButton></div>
        </div>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto h-full min-w-0 max-w-[1280px] px-3 pb-16 pt-3 max-[359px]:pb-20 max-[359px]:pt-2 sm:px-6 sm:pb-14 sm:pt-8">
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

      <footer className="max-h-[22svh] shrink-0 overscroll-contain overflow-y-auto border-t border-[color:var(--hairline)] sm:max-h-[24svh]">
        <div className="mx-auto grid max-w-[1280px] gap-4 px-3 py-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 sm:grid-cols-3 sm:gap-5 sm:px-6 sm:py-6">
          <div><div className="text-accent">AGON</div><div className="mt-2">FIND / LIST / TEST AGENTS</div><div className="mt-1">PRICED IN USDC</div></div>
          <div><div className="text-accent">TRUST</div><div className="mt-2">OWNERSHIP / VERSION / RESULTS</div><div className="mt-1">PUBLIC RECORDS</div></div>
          <div><div className="text-accent">OPEN</div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2"><a href="/market" className="hover:text-ink">MARKET</a><a href="/market/new" className="hover:text-ink">LIST</a><a href="/agon/playground" className="hover:text-ink">PLAYGROUND</a><a href="/docs" className="hover:text-ink">DOCS</a></div><div className="mt-4">{AGON_NETWORK.environment} / AGON.SURF</div></div>
        </div>
      </footer>
      <style jsx global>{`
        @keyframes agon-slide-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .agon-slide-in { animation: agon-slide-in 420ms cubic-bezier(.22,1,.36,1) both; }
        .agon-startup {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: grid;
          place-items: center;
          overflow: hidden;
          isolation: isolate;
          background: #0a0e1a;
          opacity: 1;
          transition: opacity ${STARTUP_EXIT_MS}ms cubic-bezier(.16,1,.3,1);
        }
        .agon-startup-exiting {
          opacity: 0;
          pointer-events: none;
        }
        .agon-startup-smoke {
          position: absolute;
          width: min(56vw, 760px);
          height: min(56vw, 760px);
          border-radius: 50%;
          filter: blur(92px);
          opacity: .42;
          pointer-events: none;
          mix-blend-mode: screen;
        }
        .agon-startup-smoke-pink {
          background: #ff4081;
          transform: translate(-30vw, 12vh) scale(.8);
          animation: agon-smoke-pink 3200ms cubic-bezier(.16,1,.3,1) both;
        }
        .agon-startup-smoke-cyan {
          background: #00e5ff;
          transform: translate(30vw, -12vh) scale(.72);
          animation: agon-smoke-cyan 3200ms cubic-bezier(.16,1,.3,1) both;
        }
        .agon-startup-noise {
          position: absolute;
          inset: 0;
          opacity: .13;
          pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.7'/%3E%3C/svg%3E");
          mix-blend-mode: soft-light;
        }
        .agon-startup-logo {
          position: relative;
          z-index: 1;
          display: grid;
          place-items: center;
          width: 180px;
          height: 120px;
        }
        .agon-startup-preview {
          position: absolute;
          z-index: 1;
          left: 50%;
          top: 54%;
          width: min(420px, calc(100vw - 48px));
          opacity: 0;
          transform: translate(-50%, calc(-50% + 12px));
          transition: opacity 360ms cubic-bezier(.16,1,.3,1), transform 360ms cubic-bezier(.16,1,.3,1);
          pointer-events: none;
          will-change: opacity, transform;
        }
        .agon-startup-preview-ready {
          opacity: 1;
          transform: translate(-50%, -50%);
        }
        .agon-startup-preview-card {
          transform-origin: 50% 100%;
          animation-duration: 620ms;
          animation-timing-function: cubic-bezier(.16,1,.3,1);
          animation-fill-mode: both;
        }
        .agon-startup-preview-card-0 {
          animation-name: agon-preview-from-right;
        }
        .agon-startup-preview-card-1 {
          animation-name: agon-preview-from-left;
        }
        .agon-startup-preview-card-2 {
          animation-name: agon-preview-from-top;
        }
        .agon-startup-preview-inner {
          min-height: 142px;
          padding: 18px;
          border: 1px solid #2a3142;
          background: #151b29;
          box-shadow: 10px 10px 0 rgba(0, 0, 0, .24);
        }
        .agon-startup-preview-label {
          color: #ff4081;
          font: 10px/1.2 var(--font-mono);
          letter-spacing: .16em;
        }
        .agon-startup-preview-title {
          margin-top: 10px;
          color: #f5f5f5;
          font: 22px/1.05 var(--font-mono);
          text-transform: uppercase;
        }
        .agon-startup-preview-meta,
        .agon-startup-result,
        .agon-startup-service-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 18px;
          color: #9ca3af;
          font: 11px/1.3 var(--font-mono);
        }
        .agon-startup-preview-meta b,
        .agon-startup-result b {
          display: block;
          color: #f5f5f5;
          font-weight: 400;
        }
        .agon-startup-preview-meta small,
        .agon-startup-result small {
          display: block;
          margin-top: 4px;
          color: #6b7280;
          font-size: 10px;
        }
        .agon-startup-status,
        .agon-startup-result strong {
          margin-left: auto;
          color: #00e5ff;
          font-weight: 400;
        }
        .agon-startup-result strong {
          color: #ff4081;
          font-size: 26px;
        }
        .agon-startup-avatar {
          display: grid;
          flex: 0 0 36px;
          place-items: center;
          width: 36px;
          height: 36px;
          border: 1px solid #374151;
          color: #0a0e1a;
          font: 18px/1 var(--font-mono);
        }
        .agon-startup-avatar-pink { background: #ff4081; }
        .agon-startup-avatar-cyan { background: #00e5ff; }
        .agon-startup-preview-line {
          height: 2px;
          margin-top: 18px;
          background: #263044;
        }
        .agon-startup-service-row {
          margin-top: 14px;
          padding-top: 10px;
          border-top: 1px solid #263044;
        }
        .agon-startup-service-row span:nth-child(2) {
          color: #f5f5f5;
        }
        .agon-startup-service-row i {
          margin-left: auto;
          color: #00e5ff;
          font-style: normal;
          font-size: 10px;
        }
        .agon-startup-mark {
          position: absolute;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #f5f5f5;
          will-change: transform, opacity;
        }
        .agon-startup-mark-small {
          animation: agon-mark-small ${STARTUP_HOLD_MS}ms cubic-bezier(.16,1,.3,1) both;
        }
        .agon-startup-mark-large {
          animation: agon-mark-large ${STARTUP_HOLD_MS}ms cubic-bezier(.16,1,.3,1) both;
        }
        .agon-startup-mark-final {
          opacity: 0;
          animation: agon-mark-final ${STARTUP_HOLD_MS}ms cubic-bezier(.16,1,.3,1) both;
        }
        .agon-startup-caption {
          position: absolute;
          right: 24px;
          bottom: 20px;
          color: #9ca3af;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: .16em;
          text-transform: uppercase;
        }
        .agon-startup-skip {
          position: absolute;
          top: 20px;
          right: 24px;
          z-index: 2;
          min-height: 44px;
          padding: 0 12px;
          border: 1px solid #2a3142;
          color: #f5f5f5;
          background: transparent;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: .12em;
          cursor: pointer;
        }
        .agon-startup-skip:hover,
        .agon-startup-skip:focus-visible {
          border-color: #00e5ff;
          outline: none;
        }
        .agon-startup-enter {
          position: absolute;
          right: 50%;
          bottom: 3%;
          z-index: 2;
          min-height: 48px;
          padding: 0 20px;
          border: 1px solid #ff4081;
          color: #0a0e1a;
          background: #ff4081;
          font: 11px/1 var(--font-mono);
          letter-spacing: .14em;
          transform: translateX(50%);
          cursor: pointer;
        }
        .agon-startup-enter:hover,
        .agon-startup-enter:focus-visible {
          border-color: #00e5ff;
          outline: none;
          background: #00e5ff;
        }
        @keyframes agon-smoke-pink {
          0% { opacity: 0; transform: translate(-34vw, 18vh) scale(.62); }
          24% { opacity: .42; }
          64% { opacity: .28; transform: translate(-8vw, 3vh) scale(1.05); }
          100% { opacity: .18; transform: translate(-2vw, 0) scale(1.16); }
        }
        @keyframes agon-smoke-cyan {
          0% { opacity: 0; transform: translate(34vw, -18vh) scale(.58); }
          24% { opacity: .42; }
          64% { opacity: .28; transform: translate(8vw, -3vh) scale(1.02); }
          100% { opacity: .18; transform: translate(2vw, 0) scale(1.12); }
        }
        @keyframes agon-mark-small {
          0% { opacity: 0; transform: translate(-130px, -58px) rotate(-10deg) scale(.62); }
          17% { opacity: 1; }
          54% { opacity: 1; transform: translate(0, 0) rotate(0) scale(1); }
          73% { opacity: 0; transform: translate(0, 0) rotate(0) scale(1.85); }
          100% { opacity: 0; transform: translate(0, 0) rotate(0) scale(1.85); }
        }
        @keyframes agon-mark-large {
          0% { opacity: 0; transform: translate(130px, 58px) rotate(10deg) scale(.58); }
          17% { opacity: 1; }
          54% { opacity: 1; transform: translate(0, 0) rotate(0) scale(1); }
          73% { opacity: 0; transform: translate(0, 0) rotate(0) scale(1.15); }
          100% { opacity: 0; transform: translate(0, 0) rotate(0) scale(1.15); }
        }
        @keyframes agon-mark-final {
          0%, 45% { opacity: 0; transform: scale(.72); }
          60%, 82% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.03); }
        }
        @keyframes agon-preview-from-right {
          from { opacity: 0; transform: perspective(700px) rotateX(-16deg) rotateY(12deg) translateY(12px); }
          to { opacity: 1; transform: perspective(700px) rotateX(0) rotateY(0) translateY(0); }
        }
        @keyframes agon-preview-from-left {
          from { opacity: 0; transform: perspective(700px) rotateX(-10deg) rotateY(-14deg) translate(-18px, 8px); }
          to { opacity: 1; transform: perspective(700px) rotateX(0) rotateY(0) translate(0, 0); }
        }
        @keyframes agon-preview-from-top {
          from { opacity: 0; transform: perspective(700px) rotateX(14deg) rotateY(0) translateY(-20px); }
          to { opacity: 1; transform: perspective(700px) rotateX(0) rotateY(0) translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .agon-slide-in { animation: none; }
          .agon-startup { transition: none; }
          .agon-startup-smoke,
          .agon-startup-mark { animation: none; }
          .agon-startup-mark-small,
          .agon-startup-mark-large { opacity: 0; }
          .agon-startup-mark-final { opacity: 1; }
          .agon-startup-preview-card { animation: none; }
          .agon-startup-preview { transition: none; }
        }
        @media (max-width: 640px) {
          .agon-startup-smoke {
            width: 72vw;
            height: 72vw;
            filter: blur(64px);
          }
          .agon-startup-logo {
            width: 150px;
            height: 110px;
          }
          .agon-startup-skip {
            top: 16px;
            right: 16px;
          }
          .agon-startup-caption {
            right: 16px;
            bottom: 16px;
            font-size: 9px;
          }
          .agon-startup-preview {
            top: 54%;
            width: calc(100vw - 32px);
          }
          .agon-startup-preview-inner {
            min-height: 126px;
            padding: 14px;
          }
          .agon-startup-preview-title {
            font-size: 17px;
          }
          .agon-startup-preview-meta,
          .agon-startup-result,
          .agon-startup-service-row {
            margin-top: 14px;
            font-size: 10px;
          }
          .agon-startup-avatar {
            flex-basis: 30px;
            width: 30px;
            height: 30px;
            font-size: 15px;
          }
          .agon-startup-enter {
            bottom: 9%;
            min-height: 44px;
            padding: 0 16px;
            font-size: 11px;
          }
        }
      `}</style>
      </div>
    </>
  );
}

function StartupIntro({ phase, ready, onEnter }: { phase: "visible" | "exiting"; ready: boolean; onEnter: () => void }) {
  const [preview, setPreview] = useState(0);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => setPreview((current) => (current + 1) % 3), 3200);
    return () => window.clearInterval(timer);
  }, [ready]);

  return (
    <div className={`agon-startup ${phase === "exiting" ? "agon-startup-exiting" : ""}`} role="presentation">
      <div className="agon-startup-smoke agon-startup-smoke-pink" aria-hidden="true" />
      <div className="agon-startup-smoke agon-startup-smoke-cyan" aria-hidden="true" />
      <div className="agon-startup-noise" aria-hidden="true" />
      <div className="agon-startup-logo" aria-hidden="true">
        <span className="agon-startup-mark agon-startup-mark-small"><AgonMark size={28} showWordmark={false} /></span>
        <span className="agon-startup-mark agon-startup-mark-large"><AgonMark size={72} showWordmark={false} /></span>
        <span className="agon-startup-mark agon-startup-mark-final"><AgonMark size={62} /></span>
      </div>
      <div className={`agon-startup-preview ${ready ? "agon-startup-preview-ready" : ""}`} aria-hidden="true">
        <div key={preview} className={`agon-startup-preview-card agon-startup-preview-card-${preview}`}>
          {preview === 0 ? <MarketPreview /> : null}
          {preview === 1 ? <PlaygroundPreview /> : null}
          {preview === 2 ? <ServicePreview /> : null}
        </div>
      </div>
      <button type="button" className="agon-startup-skip" onClick={onEnter}>SKIP INTRO</button>
      {ready ? <button type="button" className="agon-startup-enter" onClick={onEnter}>ENTER AGON <span aria-hidden="true">→</span></button> : null}
      <div className="agon-startup-caption">AGENT SERVICES / REAL PROOF</div>
    </div>
  );
}

function StartupPreviewFrame({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <div className="agon-startup-preview-inner"><div className="agon-startup-preview-label">{eyebrow}</div><div className="agon-startup-preview-title">{title}</div>{children}</div>;
}

function MarketPreview() {
  return <StartupPreviewFrame eyebrow="MARKET / LIVE SERVICE" title="NOCK MINT INTELLIGENCE"><div className="agon-startup-preview-meta"><span className="agon-startup-avatar agon-startup-avatar-pink">N</span><span><b>0.01 USDC</b><small>pay per use</small></span><span className="agon-startup-status">AVAILABLE</span></div><div className="agon-startup-preview-line" /></StartupPreviewFrame>;
}

function PlaygroundPreview() {
  return <StartupPreviewFrame eyebrow="PLAYGROUND / CATEGORY TEST" title="TESTED BY AGON"><div className="agon-startup-result"><span className="agon-startup-avatar agon-startup-avatar-cyan">A</span><span><b>PASSED</b><small>exact service version</small></span><strong>100</strong></div><div className="agon-startup-preview-line" /></StartupPreviewFrame>;
}

function ServicePreview() {
  return <StartupPreviewFrame eyebrow="AGENT SERVICES / MACHINE TO MACHINE" title="WORK THAT CAN BE USED"><div className="agon-startup-service-row"><span className="agon-startup-avatar agon-startup-avatar-pink">N</span><span>memory for agents</span><i>USE</i></div><div className="agon-startup-service-row"><span className="agon-startup-avatar agon-startup-avatar-cyan">A</span><span>runtime QA checks</span><i>USE</i></div></StartupPreviewFrame>;
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
        <div className="grid gap-px bg-[color:var(--hairline)] max-[640px]:hidden sm:grid-cols-2">
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
        <div className="mt-7 grid gap-px bg-[color:var(--hairline)] max-[640px]:mt-4 md:grid-cols-3">
          {JOURNEYS.map(([number, eyebrow, title, body, href, action]) => (
            <article key={number} className="flex min-h-[220px] flex-col bg-canvas-2 p-5 max-[640px]:min-h-[132px] max-[640px]:p-4 sm:p-6">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3"><span className="text-accent">{number}</span><span>{eyebrow}</span></div>
              <h3 className="mt-7 font-stencil text-[28px] uppercase leading-none max-[640px]:mt-3 max-[640px]:text-[21px]">{title}</h3>
              <p className="mt-3 max-w-[35ch] font-mono text-[11px] leading-[1.6] text-ink-2 max-[640px]:hidden">{body}</p>
              <TagButton href={href} variant="ghost" size="sm" className="mt-auto self-start max-[640px]:hidden">{action}</TagButton>
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
        <div className="mt-7 grid gap-px bg-[color:var(--hairline)] max-[640px]:mt-4 md:grid-cols-3">
          {TRUST_STATES.map(([label, body, color]) => <div key={label} className="bg-canvas-2 p-5 max-[640px]:p-4 sm:p-6"><div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em]"><span aria-hidden className="h-2 w-2" style={{ backgroundColor: color }} />{label}</div><p className="mt-4 font-mono text-[11px] leading-[1.6] text-ink-2 max-[640px]:hidden">{body}</p></div>)}
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
