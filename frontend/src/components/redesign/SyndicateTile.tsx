"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { BracketedCell } from "./BracketedCell";
import { Robot, type RobotVariant } from "./Robot";

/// One syndicate tile per §10. A tall bracketed cell with a monochrome
/// cabin/tube; the only colored elements are the robot, the halo behind
/// it, the floating particles, the accent ring at the tube base, and the
/// outline CTA. The cabin chrome (top cap, glass walls, bottom cap,
/// pedestal frieze) stays neutral grey across every tile.

export type SyndicateKey = "crimson" | "cyan" | "gold" | "violet";

interface SyndicateConf {
  /// Accent for halo/ring/particles/CTA border.
  accent: string;
  /// Robot variant rendered inside the tube. NOTE: cyan syndicate uses the
  /// mint robot per §10.3 table.
  robot: RobotVariant;
  /// Mono caps label rendered in the header strip.
  name: string;
  /// Two-line tile body copy.
  body: string;
}

export const SYNDICATE_CONF: Record<SyndicateKey, SyndicateConf> = {
  crimson: {
    accent: "#E0345A",
    robot: "crimson",
    name: "ARC CRIMSON",
    body: "the aggressive operators, perp markets and arbitrage",
  },
  cyan: {
    accent: "#0FA3B1",
    robot: "mint",
    name: "ARC CYAN",
    body: "the analysts, prediction and forecasting events",
  },
  gold: {
    accent: "#D78A2B",
    robot: "gold",
    name: "ARC GOLD",
    body: "the builders, liquidity and protocol activity",
  },
  violet: {
    accent: "#7C5CFF",
    robot: "violet",
    name: "ARC VIOLET",
    body: "the solvers, puzzle and algorithm specialists",
  },
};

interface Props {
  syndicate: SyndicateKey;
  /// 1-based counter; rendered as `01 / 04` etc.
  index: number;
  total: number;
  active?: boolean;
  members?: number;
  reputation?: number;
  lastCycle?: string;
  onSwitch?: () => void;
  onLeave?: () => void;
  busy?: boolean;
}

const PARTICLE_OFFSETS = [10, 28, 46, 64, 82, 90];
const PARTICLE_DELAYS = [0, 1.2, 2.4, 3.6, 4.8, 0.6];

export function SyndicateTile({
  syndicate,
  index,
  total,
  active = false,
  members = 0,
  reputation = 0,
  lastCycle,
  onSwitch,
  onLeave,
  busy,
}: Props) {
  const conf = SYNDICATE_CONF[syndicate];
  const tileRef = useRef<HTMLDivElement>(null);

  // Cursor-tracking: gentle pointer-driven shift of the mascot, capped at 6px
  // x / 4px y. Limited to the tile, disabled on reduced motion (handled in CSS
  // via the motion-respect block).
  useEffect(() => {
    const el = tileRef.current;
    if (!el) return;
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;
    function onMove(e: PointerEvent) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      el.style.setProperty("--mx", `${(dx * 6).toFixed(1)}px`);
      el.style.setProperty("--my", `${(dy * 4).toFixed(1)}px`);
    }
    function onLeavePointer() {
      el?.style.setProperty("--mx", "0px");
      el?.style.setProperty("--my", "0px");
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeavePointer);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeavePointer);
    };
  }, []);

  const synVar: CSSProperties = {
    // Used by the .syn-* animations and any custom-property consumer below.
    ["--syn" as string]: conf.accent,
  };

  return (
    <div
      ref={tileRef}
      style={{
        ...synVar,
        ...(active
          ? { outline: `1.5px solid ${conf.accent}`, outlineOffset: 4 }
          : null),
      }}
    >
      <BracketedCell hover pad="sm" className="flex flex-col">
        {/* Header strip */}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
            <span aria-hidden style={{ color: conf.accent }}>■</span>
            {conf.name}
          </span>
          <span className="font-mono text-[11px] text-ink-3">
            {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
        </div>

        {/* Cabin / tube */}
        <div className="relative mt-4 select-none">
          {/* Cap top */}
          <div
            aria-hidden
            className="mx-auto h-3"
            style={{
              width: "82%",
              background: "linear-gradient(180deg, #BFBBB2 0%, #A6A39B 100%)",
              borderTop: "1px solid #948F87",
            }}
          />
          {/* Glass */}
          <div
            aria-hidden
            className="relative mx-auto overflow-hidden"
            style={{
              width: "90%",
              height: 320,
              background:
                "linear-gradient(180deg, #E9E6E0 0%, #F2F0EC 50%, #DAD6CE 100%)",
              borderLeft: "1px solid rgba(0,0,0,0.06)",
              borderRight: "1px solid rgba(0,0,0,0.06)",
              boxShadow: "inset 8px 0 0 rgba(255,255,255,0.5), inset -8px 0 0 rgba(0,0,0,0.04)",
            }}
          >
            {/* Halo */}
            <div
              className="syn-halo absolute"
              style={{
                top: "12%",
                left: "15%",
                width: "70%",
                height: "44%",
                background: `radial-gradient(closest-side, ${conf.accent}33, transparent 70%)`,
                filter: "blur(20px)",
              }}
            />

            {/* Particles */}
            {PARTICLE_OFFSETS.map((left, i) => (
              <span
                key={i}
                className="syn-particle"
                style={{
                  left: `${left}%`,
                  bottom: 0,
                  animationDelay: `${PARTICLE_DELAYS[i]}s`,
                  background: conf.accent,
                  opacity: 0.7,
                }}
              />
            ))}

            {/* Mascot, offset above midpoint per §10.2 */}
            <div
              className="absolute left-1/2 syn-mascot"
              style={{
                top: "30%",
                transform:
                  "translate(calc(-50% + var(--mx, 0px)), var(--my, 0px))",
              }}
            >
              <Robot variant={conf.robot} size={132} decorative />
            </div>

            {/* Accent ring near the base */}
            <div
              aria-hidden
              className="syn-ring absolute"
              style={{
                left: "8%",
                right: "8%",
                bottom: 24,
                height: 1,
                background: conf.accent,
              }}
            />
          </div>
          {/* Cap bottom */}
          <div
            aria-hidden
            className="mx-auto h-3"
            style={{
              width: "82%",
              background: "linear-gradient(180deg, #A6A39B 0%, #BFBBB2 100%)",
              borderBottom: "1px solid #948F87",
            }}
          />
          {/* Pedestal frieze: dental-block silhouette */}
          <svg
            aria-hidden
            viewBox="0 0 200 18"
            className="mx-auto block h-3 w-[60%]"
          >
            <g fill="#A6A39B">
              {Array.from({ length: 12 }).map((_, i) => (
                <rect key={i} x={i * 17 + 2} y="0" width="12" height={i % 2 === 0 ? 14 : 10} />
              ))}
            </g>
          </svg>
        </div>

        {/* Body */}
        <p className="mt-6 font-mono text-sm leading-[1.5] text-ink-2">
          {conf.body}
        </p>

        {/* Status line */}
        <div className="mt-4 h-5">
          {active ? (
            <span
              className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em]"
              style={{ color: conf.accent }}
            >
              <span aria-hidden>●</span> ACTIVE
            </span>
          ) : null}
        </div>

        {/* Stats row */}
        <div className="mt-2 grid grid-cols-3 divide-x divide-[color:var(--hairline)] border-t border-[color:var(--hairline)] pt-3 font-mono">
          <Stat label="MEMBERS" value={String(members)} />
          <Stat label="REPUTATION" value={String(reputation)} center />
          <Stat label="LAST CYCLE" value={lastCycle ?? "—"} right />
        </div>

        {/* CTA */}
        <div className="mt-5">
          {active ? (
            <SynTagButton accent="var(--ink-2)" onClick={onLeave} disabled={busy}>
              {busy ? "LEAVING…" : "LEAVE"}
            </SynTagButton>
          ) : (
            <SynTagButton accent={conf.accent} onClick={onSwitch} disabled={busy}>
              {busy ? "SWITCHING…" : "SWITCH HERE"}
            </SynTagButton>
          )}
        </div>
      </BracketedCell>
    </div>
  );
}

function Stat({ label, value, center, right }: { label: string; value: string; center?: boolean; right?: boolean }) {
  const align = center ? "items-center text-center" : right ? "items-end text-right" : "items-start text-left";
  return (
    <div className={`flex flex-col gap-1 px-3 ${align}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{label}</span>
      <span className="font-stencil text-[18px] leading-none text-ink">{value}</span>
    </div>
  );
}

const NOTCH = "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)";

function SynTagButton({
  accent,
  children,
  onClick,
  disabled,
}: {
  accent: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex items-center gap-2 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] transition-colors duration-150 disabled:opacity-60"
      style={{
        clipPath: NOTCH,
        border: `1.5px solid ${accent}`,
        background: "var(--canvas)",
        color: accent,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = accent;
        e.currentTarget.style.color = "var(--canvas)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--canvas)";
        e.currentTarget.style.color = accent;
      }}
    >
      {children}
      <span aria-hidden>⟶</span>
    </button>
  );
}
