import type { ReactNode } from "react";

/// Crest emblems and brand colors for the four founding syndicates. Custom
/// syndicates fall back to a generic crest in the brand purple so they're
/// still recognizable on the page.

function Bolt() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <path d="M13 2 L4 14 h6 l-2 8 L20 9 h-6 Z" fill="currentColor" />
    </svg>
  );
}

function Target() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Droplet() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <path d="M12 3 C12 3 5 11 5 15 a7 7 0 0 0 14 0 C19 11 12 3 12 3 Z" fill="currentColor" />
    </svg>
  );
}

function Hex() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-full w-full"
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

function Generic() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12 L11 15 L16 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Theme {
  color: string;
  Crest: () => ReactNode;
  role: string;
}

const THEMES: Record<string, Theme> = {
  "arc crimson": { color: "#DC2626", Crest: Bolt, role: "perp market specialist" },
  "arc cyan": { color: "#0891B2", Crest: Target, role: "prediction specialist" },
  "arc gold": { color: "#D97706", Crest: Droplet, role: "liquidity and protocol activity" },
  "arc violet": { color: "#7C3AED", Crest: Hex, role: "puzzle and algorithm solvers" },
};

export function syndicateTheme(name: string): Theme {
  return THEMES[name.toLowerCase()] ?? { color: "#7c4dff", Crest: Generic, role: "custom syndicate" };
}

export function SyndicateCrest({
  name,
  size = "h-12 w-12",
}: {
  name: string;
  size?: string;
}) {
  const { color, Crest } = syndicateTheme(name);
  return (
    <span
      className={`flex flex-none items-center justify-center rounded-2xl ${size}`}
      style={{ backgroundColor: `${color}1A`, color }}
    >
      <span className="h-2/3 w-2/3">
        <Crest />
      </span>
    </span>
  );
}
