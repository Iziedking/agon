import type { ReactNode } from "react";

/// Original crest emblems, one per syndicate theme. They inherit the syndicate
/// colour via currentColor.
function Bolt() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
      <path d="M13 2 L4 14 h6 l-2 8 L20 9 h-6 Z" fill="currentColor" />
    </svg>
  );
}

function Target() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Droplet() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
      <path d="M12 3 C12 3 5 11 5 15 a7 7 0 0 0 14 0 C19 11 12 3 12 3 Z" fill="currentColor" />
    </svg>
  );
}

function Hex() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M12 2.5 L20 7 V17 L12 21.5 L4 17 V7 Z" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

const SYNDICATES: { name: string; role: string; color: string; Crest: () => ReactNode }[] = [
  { name: "arc crimson", role: "perp market specialist", color: "#DC2626", Crest: Bolt },
  { name: "arc cyan", role: "prediction specialist", color: "#0891B2", Crest: Target },
  { name: "arc gold", role: "liquidity and protocol activity", color: "#D97706", Crest: Droplet },
  { name: "arc violet", role: "puzzle and algorithm solvers", color: "#7C3AED", Crest: Hex },
];

export function Syndicates() {
  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {SYNDICATES.map((s) => (
        <div
          key={s.name}
          className="group rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)] transition-transform duration-150 hover:-translate-y-1"
        >
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ backgroundColor: `${s.color}1A`, color: s.color }}
          >
            <s.Crest />
          </div>
          <div className="mt-4 font-bubble text-xl uppercase" style={{ color: s.color }}>
            {s.name}
          </div>
          <p className="mt-1 text-sm text-pengu-dark/60">{s.role}</p>
          <div
            className="mt-5 inline-flex items-center gap-1 font-display text-xs uppercase tracking-wide"
            style={{ color: s.color }}
          >
            pick this side <span aria-hidden>→</span>
          </div>
        </div>
      ))}
    </div>
  );
}
