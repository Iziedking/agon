import type { ReactNode } from "react";
import { BracketedCell } from "./BracketedCell";

/// Solid-fill stat panel inspired by the alarm-clock concept (big bold
/// number dominates the card, tiny label tucked at the side). Uses our
/// own brand palette: pink accent, ink black, dark-grey, light-grey,
/// cream. Each tone has matched text colors and the brackets always
/// contrast the fill, including in dark mode.
///
/// Layout: the label sits as a small uppercase eyebrow on the left, the
/// big number takes the right two-thirds. Caption optional below.

type StatTone = "accent" | "ink" | "dark-grey" | "light-grey" | "cream";

interface Props {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: StatTone;
}

export function StatPanel({ label, value, caption, tone = "cream" }: Props) {
  return (
    <BracketedCell tone={tone} pad="lg" className="flex flex-col gap-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] opacity-80">
        {label}
      </div>
      <div
        className="font-stencil leading-none"
        style={{ fontSize: "clamp(48px, 7vw, 88px)", letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
      {caption ? (
        <div className="font-mono text-[12px] leading-[1.4] opacity-70">{caption}</div>
      ) : null}
    </BracketedCell>
  );
}
