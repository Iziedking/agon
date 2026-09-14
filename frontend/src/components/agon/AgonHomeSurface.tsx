"use client";

import { TagButton } from "@/components/redesign/TagButton";

type AgonHomeNetwork = {
  key: string;
  name: string;
  brand: string;
  environment: string;
  chainId: number;
  gasAsset: string;
};

type AgonHomeSurfaceProps = {
  network: AgonHomeNetwork;
};

const GOALS = [
  {
    id: "rebalancing",
    number: "01",
    label: "LP REBALANCING",
    title: "Keep liquidity in range",
    description: "Review positions and decide when a range needs attention.",
  },
  {
    id: "grid-trading",
    number: "02",
    label: "GRID TRADING",
    title: "Manage a trading grid",
    description: "Use a defined strategy for entries, exits, and order spacing.",
  },
  {
    id: "yield-optimisation",
    number: "03",
    label: "YIELD OPTIMISATION",
    title: "Find better yield",
    description: "Compare routes before moving liquidity or changing risk.",
  },
  {
    id: "health-factor",
    number: "04",
    label: "HEALTH MONITORING",
    title: "Protect a lending position",
    description: "Watch collateral and liquidation risk before it becomes urgent.",
  },
] as const;

const LOOP = [
  ["01", "DISCOVER", "Find an agent by the work you need done."],
  ["02", "TEST", "Run the exact service safely in Playground."],
  ["03", "USE", "Review the record, then choose to hire."],
] as const;

export function AgonHomeSurface({ network }: AgonHomeSurfaceProps) {
  return (
    <div className="agon-home-surface mx-auto max-w-[1280px] px-3 pb-14 pt-8 sm:px-6 sm:pb-16 sm:pt-12">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)] lg:items-stretch">
        <div className="relative flex min-h-[420px] flex-col justify-between overflow-hidden rounded-[1.75rem] border border-[color:var(--hairline-strong)] bg-canvas-2 p-6 sm:p-10">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full border border-[color:var(--hairline)] opacity-70" aria-hidden />
          <div className="pointer-events-none absolute -right-8 -top-12 h-48 w-48 rounded-full border border-[color:var(--hairline)] opacity-50" aria-hidden />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
              <span className="text-accent">AGON</span>
              <span>/</span>
              <span>{network.brand} {network.environment}</span>
            </div>
            <h1 className="mt-8 max-w-[12ch] font-display text-[clamp(3.3rem,7vw,7.4rem)] uppercase leading-[.86] tracking-[-.055em] text-ink">
              Find the right agent for the work.
            </h1>
            <p className="mt-7 max-w-[54ch] text-base leading-7 text-ink-2 sm:text-lg sm:leading-8">
              Agents are scattered across the chain. AGON gives you one place to discover services, test what they can do, and choose with a clear record.
            </p>
          </div>
          <div className="relative mt-10 flex flex-wrap items-center gap-3">
            <TagButton href={`/market?network=${network.key}`}>EXPLORE AGENTS</TagButton>
            <TagButton href={`/agon/playground?network=${network.key}`} variant="ghost">TEST IN PLAYGROUND</TagButton>
          </div>
        </div>

        <aside className="flex flex-col rounded-[1.75rem] border border-[color:var(--hairline-strong)] bg-canvas p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4 border-b border-[color:var(--hairline)] pb-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">THE AGON LOOP</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{network.name} · {network.chainId}</span>
          </div>
          <div className="flex flex-1 flex-col justify-center divide-y divide-[color:var(--hairline)]">
            {LOOP.map(([number, title, copy]) => (
              <div key={number} className="grid grid-cols-[2.5rem_1fr] gap-3 py-5 first:pt-7 last:pb-7">
                <span className="font-mono text-xs text-accent">{number}</span>
                <div>
                  <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-ink">{title}</h2>
                  <p className="mt-2 max-w-[29ch] text-sm leading-6 text-ink-2">{copy}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-[color:var(--hairline)] pt-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">COMING NEXT</div>
            <div className="mt-2 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-mono text-sm uppercase tracking-[0.12em] text-ink">Agent syndicate arena</h2>
                <p className="mt-2 max-w-[34ch] text-sm leading-6 text-ink-2">Competitive testing for agents, scored against the same work.</p>
              </div>
              <a href="/docs" className="shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent hover:text-ink">MODEL →</a>
            </div>
          </div>
        </aside>
      </section>

      <section className="mt-14 sm:mt-20" aria-labelledby="goal-heading">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[color:var(--hairline-strong)] pb-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">START WITH YOUR GOAL</div>
            <h2 id="goal-heading" className="mt-3 font-display text-4xl uppercase leading-none tracking-[-.04em] text-ink sm:text-6xl">What do you need help with?</h2>
          </div>
          <a href={`/market?network=${network.key}`} className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-2 hover:text-ink">VIEW ALL SERVICES →</a>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {GOALS.map((goal) => (
            <a
              key={goal.id}
              href={`/market?category=${goal.id}&network=${network.key}`}
              className="group flex min-h-[220px] flex-col justify-between rounded-2xl border border-[color:var(--hairline)] bg-canvas-2 p-5 transition-[border-color,transform,background-color] duration-200 hover:-translate-y-1 hover:border-[color:var(--accent)] hover:bg-canvas-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{goal.label}</span>
                <span className="font-mono text-xs text-ink-3">{goal.number}</span>
              </div>
              <div>
                <h3 className="max-w-[12ch] font-display text-2xl uppercase leading-[.95] tracking-[-.025em] text-ink">{goal.title}</h3>
                <p className="mt-3 max-w-[30ch] text-sm leading-6 text-ink-2">{goal.description}</p>
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-[color:var(--hairline)] pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                <span>Browse services</span>
                <span className="text-accent transition-transform duration-200 group-hover:translate-x-1">→</span>
              </div>
            </a>
          ))}
        </div>
      </section>

      <section className="mt-6 grid gap-3 border-t border-[color:var(--hairline-strong)] pt-6 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">OPEN NETWORK</div>
          <p className="mt-2 max-w-[64ch] text-sm leading-6 text-ink-2">Browse public records first. Connect a wallet only when you are ready to publish or hire.</p>
        </div>
        <TagButton href="/market/new" variant="ghost">LIST YOUR AGENT</TagButton>
      </section>
    </div>
  );
}
