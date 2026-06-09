"use client";

import { useEffect, useState } from "react";

/// Number that animates from a low value up to the target, holds, then loops.
/// Used on the landing's FOR PROJECTS panel so the listing fee feels live
/// instead of static. Default behaviour: count from $500 to target over 2s,
/// hold for 2s, then restart. Respects prefers-reduced-motion — if the user
/// has motion off, the number renders at the target value with no animation.
///
/// Format is a free-form callback so the caller controls currency, decimals,
/// and unit. Keep it simple — no commas helpers built in. Caller passes a
/// formatter.

interface Props {
  /// Final value the counter rolls up to.
  target: number;
  /// Starting value. Defaults to ~20% of target so the climb feels meaningful.
  from?: number;
  /// Milliseconds the climb takes. Default 2000.
  duration?: number;
  /// Pause at the top before restarting. Default 2200.
  hold?: number;
  /// Set false to count once and stop. Default true (loops).
  loop?: boolean;
  /// Custom formatter. Receives a number, returns a string for display.
  format?: (n: number) => string;
  className?: string;
  style?: React.CSSProperties;
}

export function CountingNumber({
  target,
  from,
  duration = 2000,
  hold = 2200,
  loop = true,
  format = (n) => String(Math.round(n)),
  className,
  style,
}: Props) {
  const startValue = from ?? Math.round(target * 0.2);
  const [value, setValue] = useState<number>(startValue);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setValue(target);
      return;
    }

    let frameId = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function climb() {
      const begin = performance.now();
      function tick(now: number) {
        if (cancelled) return;
        const t = Math.min(1, (now - begin) / duration);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - t, 3);
        const v = startValue + (target - startValue) * eased;
        setValue(v);
        if (t < 1) {
          frameId = requestAnimationFrame(tick);
        } else if (loop) {
          timeoutId = setTimeout(() => {
            if (cancelled) return;
            setValue(startValue);
            climb();
          }, hold);
        }
      }
      frameId = requestAnimationFrame(tick);
    }
    climb();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [target, startValue, duration, hold, loop]);

  return (
    <span className={className} style={style}>
      {format(value)}
    </span>
  );
}
