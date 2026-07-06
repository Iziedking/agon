"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Robot, TagButton } from "@/components/redesign";
import { fetchMissions, type MissionListItem } from "@/lib/missions";

/// Site-wide "new mission is live" alert. Mounted once near the app root, so it
/// surfaces on any page. Polls the mission index; when a mission opens that we
/// haven't shown before, a brand popup slides in with an animated circular
/// emblem (concentric pink rings pulsing out of the Robot). Remembers what it
/// has shown in localStorage so it never re-pops the same mission across
/// reloads. Stays silent while missions are gated off (the index is empty), on
/// the landing page (a toast over the hero is a poor first impression), and on
/// the missions pages themselves (you're already there).

const SEEN_KEY = "arcrun.missions.alerted.v1";
const POLL_MS = 20_000;
const DISMISS_MS = 14_000;

const DOMAIN_LABEL: Record<string, string> = {
  solver: "RESEARCH",
  analyst: "PREDICTION",
  scout: "DEFI",
};

function loadSeen(): Set<number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeen(s: Set<number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
  } catch {
    /* private mode / quota: a re-pop on reload is harmless */
  }
}

export function MissionAlert() {
  const pathname = usePathname() ?? "/";
  const reduce = useReducedMotion();
  const seen = useRef<Set<number> | null>(null);
  const [active, setActive] = useState<MissionListItem | null>(null);

  useEffect(() => {
    seen.current = loadSeen();
    let alive = true;

    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const rows = await fetchMissions();
      if (!alive || !seen.current) return;
      const open = rows.filter((r) => r.status === "open");
      const fresh = open.find((r) => !seen.current!.has(r.contestId));
      if (fresh) {
        // Mark every currently-open mission seen so we surface only the newest
        // and never stack popups for a backlog.
        open.forEach((r) => seen.current!.add(r.contestId));
        saveSeen(seen.current);
        setActive(fresh);
      }
    };

    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Auto-dismiss after a beat so it doesn't linger over the page.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(null), DISMISS_MS);
    return () => clearTimeout(t);
  }, [active]);

  // Stay silent on the landing page (a toast over the hero is the first thing a
  // visitor / judge sees and reads as unpolished) and on the missions pages
  // themselves (you're already there).
  const suppressed = pathname === "/" || pathname.startsWith("/missions");
  const show = !!active && !suppressed;
  const domain = active ? DOMAIN_LABEL[active.domain] ?? active.domain.toUpperCase() : "";

  return (
    <AnimatePresence>
      {show && active ? (
        <motion.div
          className="fixed bottom-5 left-5 z-50 w-[min(360px,calc(100vw-2.5rem))]"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
          transition={{ duration: reduce ? 0 : 0.34, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="relative border border-ink bg-canvas p-5">
            <Bracket pos="tl" /><Bracket pos="tr" /><Bracket pos="bl" /><Bracket pos="br" />

            <button
              onClick={() => setActive(null)}
              aria-label="dismiss"
              className="absolute right-2.5 top-2.5 font-mono text-[13px] text-ink-3 transition-colors hover:text-ink"
            >
              ×
            </button>

            <div className="flex items-center gap-4">
              <Emblem reduce={!!reduce} />
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
                  <span aria-hidden className="text-accent">■</span> NEW MISSION LIVE
                </div>
                <div className="mt-1 inline-flex border border-[color:var(--hairline-strong)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-2">
                  {domain}
                </div>
              </div>
            </div>

            <p className="mt-3 line-clamp-2 font-mono text-[13px] leading-[1.5] text-ink">{active.title}</p>

            <div className="mt-4">
              <TagButton href={`/missions/${active.contestId}`} size="sm">
                ENTER ARENA →
              </TagButton>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/// The circular motif: the Robot inside a ring, with two accent rings pulsing
/// outward on a loop. This is the "cool" focal piece, kept on brand (ink line,
/// canvas fill, pink reserved for the animated rings).
function Emblem({ reduce }: { reduce: boolean }) {
  return (
    <div className="relative h-16 w-16 shrink-0">
      {!reduce ? (
        <>
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border border-accent"
            initial={{ scale: 1, opacity: 0.55 }}
            animate={{ scale: 1.75, opacity: 0 }}
            transition={{ duration: 2.2, ease: "easeOut", repeat: Infinity }}
          />
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border border-accent"
            initial={{ scale: 1, opacity: 0.55 }}
            animate={{ scale: 1.75, opacity: 0 }}
            transition={{ duration: 2.2, ease: "easeOut", repeat: Infinity, delay: 1.1 }}
          />
        </>
      ) : null}
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full border border-ink bg-canvas-2">
        <Robot variant="pink" size={40} decorative />
      </div>
    </div>
  );
}

function Bracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const ink = "var(--ink)";
  const base = { position: "absolute" as const, width: 12, height: 12, pointerEvents: "none" as const };
  const styles: Record<typeof pos, React.CSSProperties> = {
    tl: { ...base, top: -1, left: -1, borderTop: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    tr: { ...base, top: -1, right: -1, borderTop: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
    bl: { ...base, bottom: -1, left: -1, borderBottom: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    br: { ...base, bottom: -1, right: -1, borderBottom: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
  };
  return <span aria-hidden style={styles[pos]} />;
}
