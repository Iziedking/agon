"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/// A one-shot falling celebration: ~36 colored pieces drift from above the
/// viewport down past the bottom, with randomized x, size, rotation, color, and
/// delay so it does not look choreographed. Renders fixed and pointer-events
/// none, so it sits over the page without trapping clicks. Self-unmounts after
/// the longest piece finishes. Reduced-motion users see nothing.

const COLORS = ["#7c4dff", "#ff7ab8", "#ffc24b", "#3dd9b0", "#9b6bff"] as const;
const PIECES = 36;
const STAGGER_WINDOW_S = 1.8;
const DURATION_MIN_S = 3;
const DURATION_MAX_S = 5.5;

interface Piece {
  id: number;
  left: number; // vw
  size: number; // px
  color: string;
  shape: "square" | "circle";
  delay: number; // s
  duration: number; // s
  rotateTo: number; // deg
  drift: number; // vw, horizontal drift over the fall
}

function makePieces(seed: number): Piece[] {
  // Light, deterministic-ish randomness so server and client agree on the first
  // frame and React does not warn. The seed varies per mount, so two mounts in
  // a row do not produce identical confetti.
  let s = seed;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  return Array.from({ length: PIECES }, (_, i) => ({
    id: i,
    left: rng() * 100,
    size: 8 + rng() * 8,
    color: COLORS[Math.floor(rng() * COLORS.length)] ?? COLORS[0]!,
    shape: rng() > 0.5 ? "square" : "circle",
    delay: rng() * STAGGER_WINDOW_S,
    duration: DURATION_MIN_S + rng() * (DURATION_MAX_S - DURATION_MIN_S),
    rotateTo: -360 + rng() * 720,
    drift: (rng() - 0.5) * 18,
  }));
}

export function Confetti() {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [show, setShow] = useState(true);
  const seed = useMemo(() => Math.floor(Math.random() * 0xffffffff), []);
  const pieces = useMemo(() => makePieces(seed), [seed]);

  useEffect(() => {
    setMounted(true);
    // Longest piece is delay + duration; pad a beat then unmount.
    const total = (STAGGER_WINDOW_S + DURATION_MAX_S + 0.5) * 1000;
    const t = setTimeout(() => setShow(false), total);
    return () => clearTimeout(t);
  }, []);

  if (!mounted || !show || reduce) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-modal overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          initial={{ x: `${p.left}vw`, y: "-10vh", rotate: 0, opacity: 1 }}
          animate={{ x: `${p.left + p.drift}vw`, y: "110vh", rotate: p.rotateTo, opacity: 0.9 }}
          transition={{ duration: p.duration, delay: p.delay, ease: "easeIn" }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.shape === "circle" ? 9999 : 3,
            boxShadow: "0 1px 2px rgba(27,17,64,0.18)",
          }}
        />
      ))}
    </div>
  );
}
