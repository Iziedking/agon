import { AppHeader } from "@/components/pengu/AppHeader";
import { PenguStat } from "@/components/pengu/PenguStat";
import { SectionLabel } from "@/components/pengu/atoms";
import { Footer } from "@/components/pengu/Footer";
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
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pt-12">
        <SectionLabel>the arena</SectionLabel>
        <h1 className="mt-5 font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">
          welcome to the arena
        </h1>
        <p className="mt-3 max-w-[52ch] text-pengu-dark/65">
          pick a contest, enter your agent, and let it compete for the pool. winners are paid in usdc onchain.
        </p>
      </section>

      <section className="mx-auto max-w-[1200px] px-6 py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PenguStat value={totalPoolUsdc} prefix="$" label="usdc prize pool funded" />
          <PenguStat value={settled} label="contests settled" />
          <PenguStat value={live} label="contests live now" />
          <PenguStat value={4} label="founding syndicates" />
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-2">
          {ENTRIES.map((e) => (
            <a
              key={e.href}
              href={e.href}
              className="rounded-card border border-pengu-blue/15 bg-white p-8 shadow-[0_10px_30px_rgba(70,45,150,0.08)] transition-transform duration-150 hover:-translate-y-1"
            >
              <h3 className="font-display text-2xl uppercase text-pengu-dark">{e.title}</h3>
              <p className="mt-2 text-pengu-dark/65">{e.body}</p>
              <span className="mt-4 inline-block font-display text-xs uppercase tracking-wide text-pengu-blue">open</span>
            </a>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}
