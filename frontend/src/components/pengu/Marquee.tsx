"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/// Infinite horizontal marquee. Two copies of the row make the loop seamless.
/// Reduced motion falls back to a static wrapped row.
export function Marquee({ children, duration = 32 }: { children: ReactNode; duration?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className="flex flex-wrap justify-center gap-3 px-6">{children}</div>;
  return (
    <div className="overflow-hidden">
      <motion.div
        className="flex w-max gap-3"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration, ease: "linear", repeat: Infinity }}
      >
        <div className="flex gap-3 pr-3">{children}</div>
        <div className="flex gap-3 pr-3" aria-hidden>
          {children}
        </div>
      </motion.div>
    </div>
  );
}
