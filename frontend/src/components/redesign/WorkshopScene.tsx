"use client";

import { Robot, type RobotVariant } from "./Robot";

/// Brand-vector workshop scene per §6.2 of the plan. Flat 1px-stroke
/// rectangles on canvas, layered to imply depth. Elements appear as the
/// agent's max tier rises so the surface visibly evolves with progression:
///
///   tier 0: bare desk + laptop (just enough room for the first contests)
///   tier 1: + side monitor (you started reading data)
///   tier 2: + secondary rig + chart pulse (you trade on real flows)
///   tier 3: + server tower + tape readout (the rack is online)
///   tier 4: + scanline overlay + glow ticks (command-center mode)
///
/// The Robot mascot anchors the centre; the canvas around it is the
/// scene. No bitmap, no gradient. Owner-only — shown in the active-agent
/// panel of /workshop, suitable for share-to-X screenshots.

interface Props {
  /// Highest of (scoutTier, analystTier, solverTier) for the agent.
  maxTier: number;
  /// Variant for the centre Robot. Defaults to violet.
  variant?: RobotVariant;
  /// Override outer height. Default 220.
  height?: number;
}

export function WorkshopScene({ maxTier, variant = "violet", height = 220 }: Props) {
  const t = Math.max(0, Math.min(4, Math.floor(maxTier)));
  const show = {
    sideMonitor: t >= 1,
    chartPulse: t >= 2,
    secondaryRig: t >= 2,
    serverTower: t >= 3,
    tapeReadout: t >= 3,
    scanlines: t >= 4,
    glowTicks: t >= 4,
  };

  return (
    <div
      className="relative overflow-hidden border border-[color:var(--hairline-strong)] bg-canvas-2"
      style={{ height }}
      aria-label={`workshop tier ${t}`}
    >
      {show.scanlines ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, var(--ink) 0 1px, transparent 1px 4px)",
          }}
        />
      ) : null}

      <svg
        viewBox="0 0 480 220"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        {/* floor line */}
        <line x1="0" y1="186" x2="480" y2="186" stroke="var(--ink)" strokeOpacity="0.25" />

        {/* desk slab */}
        <rect x="60" y="150" width="360" height="6" fill="var(--ink)" fillOpacity="0.10" stroke="var(--ink)" strokeOpacity="0.35" />
        <line x1="86" y1="156" x2="86" y2="186" stroke="var(--ink)" strokeOpacity="0.35" />
        <line x1="394" y1="156" x2="394" y2="186" stroke="var(--ink)" strokeOpacity="0.35" />

        {/* tier 0: bare laptop centre-left */}
        <rect x="118" y="120" width="62" height="32" fill="none" stroke="var(--ink)" strokeOpacity="0.65" />
        <rect x="124" y="124" width="50" height="22" fill="var(--ink)" fillOpacity="0.08" />
        <rect x="112" y="148" width="74" height="4" fill="var(--ink)" fillOpacity="0.25" />

        {/* tier 1+ : side monitor (right of laptop) */}
        {show.sideMonitor ? (
          <g>
            <rect x="208" y="98" width="78" height="54" fill="none" stroke="var(--ink)" strokeOpacity="0.65" />
            <rect x="214" y="102" width="66" height="42" fill="var(--ink)" fillOpacity="0.06" />
            {/* stand */}
            <rect x="240" y="152" width="14" height="6" fill="var(--ink)" fillOpacity="0.45" />
            {show.chartPulse ? (
              <polyline
                points="216,138 226,128 236,132 246,118 256,124 266,114 276,120"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.5"
                strokeLinejoin="miter"
              />
            ) : null}
          </g>
        ) : null}

        {/* tier 2+ : secondary rig (far right) */}
        {show.secondaryRig ? (
          <g>
            <rect x="310" y="86" width="74" height="66" fill="none" stroke="var(--ink)" strokeOpacity="0.65" />
            <rect x="316" y="90" width="62" height="54" fill="var(--ink)" fillOpacity="0.06" />
            <rect x="340" y="152" width="14" height="6" fill="var(--ink)" fillOpacity="0.45" />
            {/* split panes inside */}
            <line x1="347" y1="90" x2="347" y2="144" stroke="var(--ink)" strokeOpacity="0.25" />
            <line x1="316" y1="116" x2="378" y2="116" stroke="var(--ink)" strokeOpacity="0.25" />
          </g>
        ) : null}

        {/* tier 3+ : server tower (far left) */}
        {show.serverTower ? (
          <g>
            <rect x="74" y="78" width="34" height="74" fill="none" stroke="var(--ink)" strokeOpacity="0.65" />
            <rect x="78" y="82" width="26" height="6" fill="var(--ink)" fillOpacity="0.20" />
            <rect x="78" y="92" width="26" height="6" fill="var(--ink)" fillOpacity="0.20" />
            <rect x="78" y="102" width="26" height="6" fill="var(--ink)" fillOpacity="0.20" />
            <rect x="78" y="112" width="26" height="6" fill="var(--ink)" fillOpacity="0.20" />
            <rect x="78" y="122" width="26" height="6" fill="var(--ink)" fillOpacity="0.20" />
            <rect x="78" y="132" width="26" height="6" fill="var(--ink)" fillOpacity="0.20" />
            <rect x="78" y="142" width="26" height="6" fill="var(--ink)" fillOpacity="0.20" />
            {/* status dot */}
            <circle cx="100" cy="85" r="1.5" fill="var(--accent)" />
          </g>
        ) : null}

        {/* tier 3+ : tape readout strip above desk */}
        {show.tapeReadout ? (
          <g fontFamily="monospace" fontSize="7" fill="var(--ink)" fillOpacity="0.55">
            <rect x="200" y="62" width="200" height="14" fill="none" stroke="var(--ink)" strokeOpacity="0.30" />
            <text x="206" y="72">USDC 1.0001 ▲</text>
            <text x="270" y="72">VOL 248K</text>
            <text x="330" y="72">PNL +12%</text>
          </g>
        ) : null}

        {/* tier 4 : glow ticks under the centre */}
        {show.glowTicks ? (
          <g>
            <rect x="120" y="172" width="240" height="2" fill="var(--accent)" fillOpacity="0.5" />
            <rect x="180" y="176" width="120" height="2" fill="var(--accent)" fillOpacity="0.3" />
          </g>
        ) : null}
      </svg>

      {/* Centred Robot mascot, anchored above the desk line. Decorative. */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%]">
        <Robot variant={variant} size={Math.round(height * 0.62)} decorative />
      </div>

      {/* Tier readout bottom-left */}
      <div className="absolute bottom-2 left-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
        TIER {t} · WORKSHOP
      </div>
    </div>
  );
}
