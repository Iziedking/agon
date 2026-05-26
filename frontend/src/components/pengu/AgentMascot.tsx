/// An ArcRun agent: a boxy little bot with a visor, antenna, side arms, a chest
/// readout, and stubby feet. Deliberately mechanical, never a penguin. The
/// chassis silhouette is the same across syndicates; what changes is the
/// visor pattern, antenna, and chest readout, so a row of four reads as
/// "same family, different role" rather than four random toys.
///
/// Props:
///   color    chassis color (overrides variant default)
///   variant  syndicate (default | crimson | cyan | gold | violet) — picks
///            visor + chest + antenna design
///   mood     idle | focus | win | rugged — drives expression and chest state
///   live     when true, adds a subtle breath animation so the agent reads as
///            "powered on" instead of static
///   className tailwind sizing
import type { CSSProperties } from "react";

export type AgentVariant = "default" | "crimson" | "cyan" | "gold" | "violet";
export type AgentMood = "idle" | "focus" | "win" | "rugged";

const VARIANT_COLOR: Record<AgentVariant, string> = {
  default: "#7c4dff",
  crimson: "#DC2626",
  cyan: "#0891B2",
  gold: "#D97706",
  violet: "#7C3AED",
};

interface MascotProps {
  color?: string;
  variant?: AgentVariant;
  mood?: AgentMood;
  live?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function AgentMascot({
  color,
  variant = "default",
  mood = "idle",
  live = false,
  className = "",
  style,
}: MascotProps) {
  const chassis = color ?? VARIANT_COLOR[variant];
  const dark = "#1b1140";
  const screen = mood === "rugged" ? "#2a1a4a" : "#ffffff";

  return (
    <svg
      viewBox="0 0 120 160"
      className={`${className} ${live ? "breath" : ""}`}
      style={style}
      role="img"
      aria-label="ArcRun agent"
    >
      {/* antenna varies by variant */}
      <Antenna variant={variant} color={chassis} dark={dark} mood={mood} />

      {/* arms */}
      <rect x="6" y="58" width="14" height="36" rx="7" fill={chassis} />
      <rect x="100" y="58" width="14" height="36" rx="7" fill={chassis} />

      {/* chassis */}
      <rect x="20" y="28" width="80" height="86" rx="26" fill={chassis} />

      {/* visor base */}
      <rect x="32" y="44" width="56" height="28" rx="14" fill={dark} />

      {/* visor expression varies by mood (and slightly by variant) */}
      <Visor variant={variant} color={chassis} mood={mood} />

      {/* chest readout, screen first then variant-specific content */}
      <rect x="38" y="82" width="44" height="22" rx="7" fill={screen} />
      <ChestReadout variant={variant} color={chassis} mood={mood} />

      {/* feet */}
      <rect x="34" y="112" width="18" height="22" rx="6" fill={chassis} />
      <rect x="68" y="112" width="18" height="22" rx="6" fill={chassis} />
      <rect x="30" y="130" width="26" height="10" rx="5" fill={dark} />
      <rect x="64" y="130" width="26" height="10" rx="5" fill={dark} />

      {/* victory sparks, only on the winning mood */}
      {mood === "win" ? <WinSparks color={chassis} /> : null}
    </svg>
  );
}

function Antenna({ variant, color, dark, mood }: { variant: AgentVariant; color: string; dark: string; mood: AgentMood }) {
  if (variant === "crimson") {
    // pair of short antennae for the heavy chassis
    return (
      <g>
        <line x1="46" y1="30" x2="42" y2="18" stroke={dark} strokeWidth="3.5" strokeLinecap="round" />
        <line x1="74" y1="30" x2="78" y2="18" stroke={dark} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="42" cy="14" r="4" fill={color} className={mood === "win" ? "glow-pulse" : ""} style={{ color }} />
        <circle cx="78" cy="14" r="4" fill={color} className={mood === "win" ? "glow-pulse" : ""} style={{ color }} />
      </g>
    );
  }
  if (variant === "cyan") {
    // antenna with a brain-wave squiggle so the analyst looks like it's thinking
    return (
      <g>
        <line x1="60" y1="30" x2="60" y2="18" stroke={dark} strokeWidth="4" strokeLinecap="round" />
        <path d="M52 14 Q56 10 60 14 T68 14" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="60" cy="11" r="3" fill={color} />
      </g>
    );
  }
  if (variant === "gold") {
    // tall thin antenna for the courier
    return (
      <g>
        <line x1="60" y1="30" x2="60" y2="10" stroke={dark} strokeWidth="3" strokeLinecap="round" />
        <circle cx="60" cy="7" r="4" fill={color} className={mood === "focus" || mood === "win" ? "glow-pulse" : ""} style={{ color }} />
      </g>
    );
  }
  if (variant === "violet") {
    // antenna with rotating ring (the solver is always orbiting an idea)
    return (
      <g>
        <line x1="60" y1="30" x2="60" y2="16" stroke={dark} strokeWidth="4" strokeLinecap="round" />
        <ellipse cx="60" cy="11" rx="9" ry="3.5" fill="none" stroke={color} strokeWidth="2" />
        <circle cx="60" cy="11" r="3.5" fill={color} />
      </g>
    );
  }
  // default
  return (
    <g>
      <line x1="60" y1="30" x2="60" y2="16" stroke={dark} strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="11" r="6" fill={color} />
    </g>
  );
}

function Visor({ variant, color, mood }: { variant: AgentVariant; color: string; mood: AgentMood }) {
  // Rugged mood always blanks the visor; nothing to read inside.
  if (mood === "rugged") {
    return (
      <g>
        <line x1="40" y1="52" x2="50" y2="64" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <line x1="50" y1="52" x2="40" y2="64" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <line x1="70" y1="52" x2="80" y2="64" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <line x1="80" y1="52" x2="70" y2="64" stroke={color} strokeWidth="3" strokeLinecap="round" />
      </g>
    );
  }

  // Win mood overrides variants with star eyes.
  if (mood === "win") {
    return (
      <g>
        <Star cx={49} cy={58} color={color} />
        <Star cx={71} cy={58} color={color} />
      </g>
    );
  }

  // Focus mood narrows the eyes a touch on every variant.
  const eyeRY = mood === "focus" ? 4 : 6;

  if (variant === "crimson") {
    // angular reinforced visor bars
    return (
      <g>
        <rect x="36" y="46" width="2" height="24" fill={color} opacity="0.5" />
        <rect x="46" y="46" width="2" height="24" fill={color} opacity="0.5" />
        <rect x="72" y="46" width="2" height="24" fill={color} opacity="0.5" />
        <rect x="82" y="46" width="2" height="24" fill={color} opacity="0.5" />
        <ellipse cx="49" cy="58" rx="5" ry={eyeRY} fill="#ffffff" className="blink" />
        <ellipse cx="71" cy="58" rx="5" ry={eyeRY} fill={color} />
      </g>
    );
  }
  if (variant === "cyan") {
    // round goggles, two big rings
    return (
      <g>
        <circle cx="49" cy="58" r="9" fill="none" stroke={color} strokeWidth="2" opacity="0.5" />
        <circle cx="71" cy="58" r="9" fill="none" stroke={color} strokeWidth="2" opacity="0.5" />
        <ellipse cx="49" cy="58" rx="5" ry={eyeRY} fill="#ffffff" className="blink" />
        <ellipse cx="71" cy="58" rx="5" ry={eyeRY} fill={color} />
      </g>
    );
  }
  if (variant === "gold") {
    // wide single visor slit, plus eye pair behind it
    return (
      <g>
        <rect x="34" y="56" width="52" height="4" rx="2" fill={color} opacity="0.45" />
        <ellipse cx="49" cy="58" rx="4.5" ry={eyeRY} fill="#ffffff" className="blink" />
        <ellipse cx="71" cy="58" rx="4.5" ry={eyeRY} fill={color} />
      </g>
    );
  }
  if (variant === "violet") {
    // V-shape angular cut for the solver
    return (
      <g>
        <path d="M40 50 L60 64 L80 50" fill="none" stroke={color} strokeWidth="2" opacity="0.5" strokeLinejoin="round" />
        <ellipse cx="49" cy="58" rx="5" ry={eyeRY} fill="#ffffff" className="blink" />
        <ellipse cx="71" cy="58" rx="5" ry={eyeRY} fill={color} />
      </g>
    );
  }
  // default
  return (
    <g>
      <ellipse cx="49" cy="58" rx="6" ry={eyeRY} fill="#ffffff" className="blink" />
      <ellipse cx="71" cy="58" rx="6" ry={eyeRY} fill={color} />
    </g>
  );
}

function ChestReadout({ variant, color, mood }: { variant: AgentVariant; color: string; mood: AgentMood }) {
  if (mood === "rugged") {
    return (
      <g>
        <line x1="44" y1="86" x2="76" y2="100" stroke="#e0466e" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="76" y1="86" x2="44" y2="100" stroke="#e0466e" strokeWidth="2.5" strokeLinecap="round" />
      </g>
    );
  }

  const full = mood === "win";

  if (variant === "crimson") {
    // power gauge: three vertical bars, filling
    return (
      <g>
        <rect x="46" y="93" width="4" height="6" rx="1" fill={color} opacity={full ? 1 : 0.85} />
        <rect x="54" y="89" width="4" height="10" rx="1" fill={color} opacity={full ? 1 : 0.75} />
        <rect x="62" y="86" width="4" height="13" rx="1" fill={color} opacity={full ? 1 : 0.65} />
        <rect x="70" y="84" width="4" height="15" rx="1" fill={color} opacity={full ? 1 : 0.5} />
      </g>
    );
  }
  if (variant === "cyan") {
    // wave line: a low-amplitude EKG
    return (
      <polyline
        points="42,94 48,94 52,88 56,98 60,90 64,96 68,92 72,94 78,94"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  if (variant === "gold") {
    // tx counter style: a dot plus a chunky number
    return (
      <g>
        <circle cx="46" cy="93" r="3" fill={color} className={full ? "glow-pulse" : ""} style={{ color }} />
        <rect x="54" y="89" width="22" height="8" rx="2" fill={color} opacity="0.18" />
        <rect x="56" y="91" width={full ? 18 : 12} height="4" rx="1" fill={color} />
      </g>
    );
  }
  if (variant === "violet") {
    // 3x2 grid of cells: solver's working memory
    return (
      <g>
        {[0, 1, 2].map((c) =>
          [0, 1].map((r) => (
            <rect
              key={`${c}-${r}`}
              x={44 + c * 11}
              y={88 + r * 7}
              width="8"
              height="5"
              rx="1.5"
              fill={color}
              opacity={(c + r) % 2 === 0 || full ? 0.95 : 0.35}
            />
          )),
        )}
      </g>
    );
  }
  // default: dot + bar
  return (
    <g>
      <circle cx="49" cy="93" r="3.2" fill={color} />
      <rect x="57" y="90" width="18" height="6" rx="3" fill={color} fillOpacity={full ? 1 : 0.45} />
    </g>
  );
}

function Star({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <path
        d="M0 -6 L1.6 -1.6 L6 -1.6 L2.4 1 L3.6 5.4 L0 2.8 L-3.6 5.4 L-2.4 1 L-6 -1.6 L-1.6 -1.6 Z"
        fill={color}
      />
    </g>
  );
}

function WinSparks({ color }: { color: string }) {
  return (
    <g>
      <circle cx="12" cy="40" r="2" fill={color} className="sparkle" style={{ animationDelay: "0s" }} />
      <circle cx="108" cy="50" r="2" fill={color} className="sparkle" style={{ animationDelay: "0.4s" }} />
      <circle cx="16" cy="120" r="1.6" fill={color} className="sparkle" style={{ animationDelay: "0.7s" }} />
      <circle cx="104" cy="118" r="1.6" fill={color} className="sparkle" style={{ animationDelay: "1.0s" }} />
    </g>
  );
}
