/// The single flat-vector robot family used everywhere a mascot appears.
/// Replaces every prior AgentMascot, 3D bot, glowing CRT face, and orange-
/// haloed agent-lock illustration. Flat fills only: no gradients, no rim
/// lighting, no halo, no drop shadow.
///
/// One body silhouette: rounded square head with two square ears, a single
/// antenna with a ball tip, square eye-plate with two round eyes (one solid
/// white, one variant iris), a rectangular mouth-plate with a smaller pill
/// inside, a rounded chest, two short legs ending in dark boots.
///
/// Five color variants — Violet/Pink/Gold/Mint/Crimson — keyed to syndicate
/// identity. Eye-plate and boots are always the same dark #1A1230.

export type RobotVariant = "violet" | "pink" | "gold" | "mint" | "crimson";

const VARIANT_FILL: Record<RobotVariant, string> = {
  violet: "#7C5CFF",
  pink: "#FF3D8A",
  gold: "#FFC93A",
  mint: "#2BD4A3",
  crimson: "#E0345A",
};

const PLATE = "#1A1230";

const VARIANT_ARIA: Record<RobotVariant, string> = {
  violet: "Arc Violet syndicate mascot",
  pink: "ArcRun pink mascot",
  gold: "Arc Gold syndicate mascot",
  mint: "Arc Cyan syndicate mascot",
  crimson: "Arc Crimson syndicate mascot",
};

interface Props {
  variant?: RobotVariant;
  size?: number;
  className?: string;
  /// Set true when the robot is purely decorative (e.g. a row of five on the
  /// landing hero). Hides from assistive tech.
  decorative?: boolean;
  ariaLabel?: string;
}

export function Robot({ variant = "pink", size = 96, className = "", decorative = false, ariaLabel }: Props) {
  const fill = VARIANT_FILL[variant];
  const label = ariaLabel ?? VARIANT_ARIA[variant];

  return (
    <svg
      viewBox="0 0 100 120"
      width={size}
      height={size * 1.2}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      className={className}
    >
      {/* antenna */}
      <line x1="50" y1="8" x2="50" y2="18" stroke={PLATE} strokeWidth="2.5" strokeLinecap="square" />
      <rect x="46.5" y="2" width="7" height="7" rx="1.2" fill={fill} />

      {/* ears */}
      <rect x="12" y="32" width="8" height="14" rx="1.5" fill={fill} />
      <rect x="80" y="32" width="8" height="14" rx="1.5" fill={fill} />

      {/* head */}
      <rect x="20" y="18" width="60" height="46" rx="8" fill={fill} />

      {/* eye plate */}
      <rect x="26" y="28" width="48" height="18" rx="2" fill={PLATE} />
      {/* eyes: one solid white, one variant iris */}
      <circle cx="38" cy="37" r="4.5" fill="#FFFFFF" />
      <circle cx="62" cy="37" r="4.5" fill={fill} />
      {/* pupil dot in the white eye for a hint of direction */}
      <circle cx="39" cy="37" r="1.8" fill={PLATE} />

      {/* mouth plate */}
      <rect x="32" y="50" width="36" height="10" rx="2" fill={PLATE} />
      <rect x="40" y="53.5" width="20" height="3" rx="1.2" fill={fill} />

      {/* neck gap (canvas color) */}
      <rect x="36" y="64" width="28" height="4" fill="transparent" />

      {/* chest */}
      <rect x="22" y="68" width="56" height="30" rx="6" fill={fill} />

      {/* legs */}
      <rect x="32" y="98" width="10" height="14" fill={fill} />
      <rect x="58" y="98" width="10" height="14" fill={fill} />

      {/* boots */}
      <rect x="29" y="110" width="16" height="6" rx="1" fill={PLATE} />
      <rect x="55" y="110" width="16" height="6" rx="1" fill={PLATE} />
    </svg>
  );
}

/// Stable id-to-variant mapping so the same agent always reads in the same
/// color across the app. Mirrors the prior variantForAgentId so swaps are
/// mechanical.
const ORDER: RobotVariant[] = ["violet", "pink", "gold", "mint", "crimson"];
export function robotVariantForId(id: number): RobotVariant {
  return ORDER[id % ORDER.length]!;
}
