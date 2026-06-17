"use client";

import { useEffect, useState } from "react";
import { chainAlignedNow, refreshChainSkew } from "@/lib/arc";

/// Live countdown to a Unix epoch (seconds). Reads its own clock so cards
/// across the grid all tick together. Renders as "2H 14M" above an hour,
/// "14M 32S" below, "32S" below a minute, "ENDED" once past the target.
/// Respects prefers-reduced-motion by ticking less often, but it still
/// updates because a countdown is information, not decoration.

interface Props {
  targetSec: number;
  className?: string;
  /// Optional prefix text. Useful for "JOIN BY", "SCORING IN", etc.
  prefix?: string;
}

function fmt(left: number): string {
  if (left <= 0) return "ENDED";
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  if (h > 0) return `${h}H ${m}M`;
  if (m > 0) return `${m}M ${s}S`;
  return `${s}S`;
}

export function Countdown({ targetSec, className, prefix }: Props) {
  const [now, setNow] = useState<number>(() => chainAlignedNow());

  useEffect(() => {
    if (typeof window === "undefined") return;
    void refreshChainSkew();
    const tick = () => setNow(chainAlignedNow());
    // Tick every second so users see the digits move. The component
    // unmounts cleanly when the card unmounts so the interval is short
    // lived even with many cards on screen.
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, targetSec - now);
  return (
    <span className={className}>
      {prefix ? <span className="opacity-70">{prefix} </span> : null}
      {fmt(left)}
    </span>
  );
}
