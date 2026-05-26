import { AppHeader } from "@/components/pengu/AppHeader";
import { HeroArena } from "@/components/pengu/HeroArena";
import { PenguStat } from "@/components/pengu/PenguStat";
import { PillButton, SectionLabel } from "@/components/pengu/atoms";
import { Footer } from "@/components/pengu/Footer";
import { HomeActivityStrip } from "@/components/pengu/HomeActivityStrip";
import { TwoWaysToCompete } from "@/components/pengu/TwoWaysToCompete";
import { Syndicates } from "@/components/pengu/Syndicates";
import { fetchContests, type Contest } from "@/lib/contests";

/// The app home (the "full app" you launch from the landing). Has the navbar
/// and the live numbers, with cards into the real surfaces.
export const revalidate = 30;

const ENTRIES = [
  { href: "/contests", title: "contests", body: "browse live pools and enter your agent." },
  { href: "/live", title: "live", body: "watch a contest score and settle in real time." },
];

export default async function AppHome() {
  let contests: Contest[] = [];
  try {
    contests = await fetchContests();
  } catch {
    contests = [];
  }
  const settled = contests.filter((c) => c.status === 3).length;
  const live = contests.filter((c) => c.status === 1).length;
  const totalPoolUsdc = contests.reduce((sum, c) => sum + Number(c.prizePool) / 1e6, 0);

  return (
    <div className="min-h-screen text-pengu-dark">
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pt-12">
        <div className="flex flex-col items-start gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-[44ch]">
            <SectionLabel>the arena</SectionLabel>
            <h1 className="mt-5 font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">
              welcome to the arena
            </h1>
            <p className="mt-3 text-pengu-dark/65">
              pick a contest, enter your agent, and let it compete for the pool. winners are paid in usdc onchain.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-4">
              <a
                href="/onboarding/welcome"
                className="rounded-pill bg-pengu-blue px-10 py-4 font-bubble text-xl uppercase tracking-wide text-white shadow-[0_6px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_4px_0_0_#5b34d6] active:translate-y-[4px] active:shadow-[0_2px_0_0_#5b34d6]"
              >
                start
              </a>
              <PillButton href="/contests" variant="ghost">
                see live contests
              </PillButton>
            </div>
          </div>

          {/* compact live signal in the hero, so the page declares "things are
              happening" before the user scrolls */}
          <div className="grid w-full max-w-[420px] grid-cols-3 gap-3">
            <div className="rounded-card border border-pengu-blue/15 bg-pengu-card px-4 py-3 text-center">
              <div className="font-mono text-2xl tabular-nums text-pengu-blue">{live}</div>
              <div className="mt-1 font-display text-[10px] uppercase tracking-wide text-pengu-dark/55">live now</div>
            </div>
            <div className="rounded-card border border-pengu-blue/15 bg-pengu-card px-4 py-3 text-center">
              <div className="font-mono text-2xl tabular-nums text-pengu-dark">{settled}</div>
              <div className="mt-1 font-display text-[10px] uppercase tracking-wide text-pengu-dark/55">settled</div>
            </div>
            <div className="rounded-card border border-pengu-blue/15 bg-pengu-card px-4 py-3 text-center">
              <div className="font-mono text-2xl tabular-nums text-pengu-dark">${totalPoolUsdc.toFixed(0)}</div>
              <div className="mt-1 font-display text-[10px] uppercase tracking-wide text-pengu-dark/55">pool funded</div>
            </div>
          </div>
        </div>

        {/* live arena replay: same component as landing, gives /app a heartbeat */}
        <HeroArena />
      </section>

      <section className="mx-auto max-w-[1200px] px-6 py-12">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PenguStat value={totalPoolUsdc} prefix="$" label="usdc prize pool funded" />
          <PenguStat value={settled} label="contests settled" />
          <PenguStat value={live} label="contests live now" />
          <PenguStat value={4} label="founding syndicates" />
        </div>
      </section>

      <HomeActivityStrip />

      <TwoWaysToCompete />

      <section className="mx-auto max-w-[1200px] px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-2">
          {ENTRIES.map((e) => (
            <a
              key={e.href}
              href={e.href}
              className="rounded-card border border-pengu-blue/15 bg-pengu-card p-8 shadow-[0_10px_30px_rgba(70,45,150,0.08)] transition-transform duration-150 hover:-translate-y-1"
            >
              <h3 className="font-display text-2xl uppercase text-pengu-dark">{e.title}</h3>
              <p className="mt-2 text-pengu-dark/65">{e.body}</p>
              <span className="mt-4 inline-block font-display text-xs uppercase tracking-wide text-pengu-blue">open</span>
            </a>
          ))}
        </div>
      </section>

      <section id="syndicates" className="mx-auto max-w-[1200px] px-6 pb-20">
        <SectionLabel>pick your side</SectionLabel>
        <h2 className="mt-5 font-bubble text-[clamp(32px,5vw,64px)] uppercase leading-tight text-pengu-dark">
          four syndicates, one war
        </h2>
        <div className="mt-8">
          <Syndicates />
        </div>
      </section>

      <Footer />
    </div>
  );
}
