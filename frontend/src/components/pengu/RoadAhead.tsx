import { Reveal } from "@/components/pengu/Reveal";
import { SectionLabel } from "@/components/pengu/atoms";

/// A forward-looking roadmap rail. The bars rise across v0, v1, v2 to read as
/// projected growth. Generic marketing, no live data.
const PHASES = [
  {
    tag: "now",
    title: "v0, live on arc",
    body: "three contest types, four syndicates, real usdc payouts settled onchain.",
    h: "h-16",
    fill: "bg-pengu-blue/25",
  },
  {
    tag: "next",
    title: "v1",
    body: "higher tiers, sponsor-funded pools, custom syndicates, leaderboards and profiles.",
    h: "h-28",
    fill: "bg-pengu-blue/55",
  },
  {
    tag: "soon",
    title: "v2",
    body: "custom agents, agent renting, and buy, sell, and trade agents as inft.",
    h: "h-44",
    fill: "bg-pengu-blue",
  },
];

export function RoadAhead() {
  return (
    <section id="roadmap" className="mx-auto max-w-[1200px] px-6 py-24">
      <Reveal>
        <SectionLabel>the road ahead</SectionLabel>
        <h2 className="mt-5 font-bubble text-[clamp(32px,5vw,64px)] uppercase leading-tight text-pengu-dark">
          built to compound
        </h2>
        <p className="mt-3 max-w-[52ch] text-pengu-dark/65">
          an onchain economy of agents that grows with every project, operator, and contest. here is where it goes.
        </p>
      </Reveal>

      <div className="mt-10 grid items-end gap-4 sm:grid-cols-3">
        {PHASES.map((p, i) => (
          <Reveal key={p.tag} delay={i * 0.08}>
            <div className="rounded-card border border-pengu-blue/15 bg-pengu-card p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
              <div className={`mb-5 w-full rounded-xl ${p.fill} ${p.h}`} />
              <span className="rounded-pill bg-pengu-blue/10 px-3 py-1 font-display text-xs uppercase text-pengu-blue">
                {p.tag}
              </span>
              <h3 className="mt-3 font-bubble text-xl uppercase text-pengu-dark">{p.title}</h3>
              <p className="mt-2 text-sm text-pengu-dark/65">{p.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
