"use client";

import { motion, useReducedMotion } from "framer-motion";

const CYCLE = 5; // seconds: the whole sequence replays every 5s
const BOUNCE = 0.55; // seconds per pill hop
const STAGGER = 0.4; // arc first, then circle, then usdc

const ITEMS = [
  { name: "arc", src: "/brands/arc.png" },
  { name: "circle", src: "/brands/circle.png" },
  { name: "usdc", src: "/brands/usdc.png" },
];

/// The "built on" row, using the partners' real logos. Each pill hops up in
/// turn (arc, circle, usdc), settles level, then repeats every 5 seconds.
/// Static if the user prefers reduced motion.
export function BuiltOn() {
  const reduce = useReducedMotion();

  return (
    <div className="mt-8 flex flex-wrap items-end justify-center gap-4">
      {ITEMS.map(({ name, src }, i) => (
        <motion.span
          key={name}
          className="inline-flex items-center gap-3 rounded-pill border border-pengu-blue/15 bg-white px-7 py-4 font-bubble text-xl uppercase text-pengu-dark/70 shadow-[0_8px_24px_rgba(70,45,150,0.06)]"
          animate={reduce ? undefined : { y: [0, -18, 0] }}
          transition={
            reduce
              ? undefined
              : {
                  duration: BOUNCE,
                  ease: "easeInOut",
                  times: [0, 0.5, 1],
                  delay: i * STAGGER,
                  repeat: Infinity,
                  repeatDelay: CYCLE - BOUNCE,
                }
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`${name} logo`} className="h-7 w-7 shrink-0 rounded-lg" />
          {name}
        </motion.span>
      ))}
    </div>
  );
}
