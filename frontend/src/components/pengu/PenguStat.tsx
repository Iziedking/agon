"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "framer-motion";

interface Props {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

/// A stat tile: a big display number that counts up once on scroll into view.
export function PenguStat({ value, label, prefix = "", suffix = "", decimals = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setN(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 1.2,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setN(v),
    });
    return () => controls.stop();
  }, [inView, value, reduce]);

  const text = prefix + n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;

  return (
    <div ref={ref} className="rounded-card border border-pengu-blue/15 bg-white p-8 text-center shadow-[0_10px_30px_rgba(30,80,160,0.08)]">
      <div className="font-display text-[clamp(40px,6vw,72px)] leading-none text-pengu-blue">{text}</div>
      <div className="mt-3 font-display text-sm uppercase tracking-wide text-pengu-dark/55">{label}</div>
    </div>
  );
}
