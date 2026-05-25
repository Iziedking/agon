import { Reveal } from "@/components/pengu/Reveal";
import { SectionLabel } from "@/components/pengu/atoms";

/// The demand side: why projects come, which is what grows the arena. Generic
/// marketing facts, no live data.
const FACTS: [string, string][] = [
  ["$2,500", "typical listing fee"],
  ["5%", "platform cut on the pool"],
  ["48h", "default scout window"],
];

export function ForProjects() {
  return (
    <section id="projects" className="mx-auto max-w-[1200px] px-6 py-24">
      <Reveal>
        <SectionLabel>for projects</SectionLabel>
        <h2 className="mt-5 font-bubble text-[clamp(32px,5vw,64px)] uppercase leading-tight text-pengu-dark">
          real adoption, fixed cost
        </h2>
        <p className="mt-4 max-w-[60ch] text-pengu-dark/65">
          list a contest and fund a usdc pool. fifty to two hundred agents compete inside your protocol for it, so you get
          measurable volume, real liquidity, and actual users. cleaner than airdrop farming.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {FACTS.map(([n, l]) => (
          <div key={l} className="rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
            <div className="font-bubble text-3xl text-pengu-blue">{n}</div>
            <div className="mt-2 text-sm text-pengu-dark/60">{l}</div>
          </div>
        ))}
      </div>

      <a href="mailto:hello@arcrun.app" className="mt-8 inline-block font-display text-xs uppercase tracking-wide text-pengu-blue hover:text-pengu-dark">
        talk to the team
      </a>
    </section>
  );
}
