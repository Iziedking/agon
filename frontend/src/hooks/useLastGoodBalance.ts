"use client";

import { useEffect, useMemo, useState } from "react";

/// Last-known-good balance, so a transient RPC failure (the public Arc RPC
/// rate-limits bursts) shows the previous value instead of blanking to "—".
///
/// react-query already keeps `data` across a failed BACKGROUND refetch, but it
/// starts empty on a full page reload — so a hiccup right at load blanks the chip.
/// This persists every successful read to localStorage (per address+chain) and
/// serves it, with its age, whenever the live read has no value yet.
///
/// `fresh` is the wagmi `data` (bigint when read, undefined while pending/failed).
/// Returns the value to show and `staleSeconds` (null when the value is fresh, a
/// number when it is the cached fallback).
export interface LastGoodBalance {
  value: bigint | null;
  staleSeconds: number | null;
}

interface Cached {
  wei: string;
  at: number;
}

export function useLastGoodBalance(key: string | null, fresh: bigint | undefined): LastGoodBalance {
  const [cached, setCached] = useState<Cached | null>(null);

  // Load whatever was persisted for this key (address+chain) on mount / key change.
  useEffect(() => {
    if (!key || typeof window === "undefined") {
      setCached(null);
      return;
    }
    try {
      const raw = window.localStorage.getItem(key);
      setCached(raw ? (JSON.parse(raw) as Cached) : null);
    } catch {
      setCached(null);
    }
  }, [key]);

  // Persist every successful read so the next load / next hiccup has a fallback.
  useEffect(() => {
    if (!key || typeof fresh !== "bigint" || typeof window === "undefined") return;
    const rec: Cached = { wei: fresh.toString(), at: Date.now() };
    try {
      window.localStorage.setItem(key, JSON.stringify(rec));
    } catch {
      /* private mode / quota — the in-memory value below still serves this session */
    }
    setCached(rec);
  }, [key, fresh]);

  return useMemo(() => {
    if (typeof fresh === "bigint") return { value: fresh, staleSeconds: null };
    if (cached) {
      let wei: bigint;
      try {
        wei = BigInt(cached.wei);
      } catch {
        return { value: null, staleSeconds: null };
      }
      return { value: wei, staleSeconds: Math.max(0, Math.round((Date.now() - cached.at) / 1000)) };
    }
    return { value: null, staleSeconds: null };
  }, [fresh, cached]);
}

/// Compact "how long ago" label for a stale balance.
export function balanceAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}
