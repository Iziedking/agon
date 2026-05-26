"use client";

import { useEffect, useRef, useState } from "react";
import { fetchAgentNames } from "@/lib/profiles";

/// Bulk name lookup for live surfaces that only know agentIds (live standings,
/// the contest stage, anywhere a broadcast frame lands without names). Returns
/// a Map<agentId, name>; caller can do `names.get(id) ?? \`agent #${id}\``.
/// Refetches when the id set changes and only sends fresh ids the second time.
export function useAgentNames(ids: number[]): Map<number, string> {
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const fetched = useRef<Set<number>>(new Set());

  useEffect(() => {
    const fresh = ids.filter((id) => Number.isFinite(id) && id > 0 && !fetched.current.has(id));
    if (fresh.length === 0) return;
    let stopped = false;
    void fetchAgentNames(fresh).then((m) => {
      if (stopped) return;
      for (const id of fresh) fetched.current.add(id);
      setNames((prev) => {
        const merged = new Map(prev);
        for (const [k, v] of m) merged.set(k, v);
        return merged;
      });
    });
    return () => {
      stopped = true;
    };
  }, [ids.join(",")]);

  return names;
}

/// Format helper kept next to the hook so callers import one thing.
export function nameFor(map: Map<number, string>, agentId: number): string {
  return map.get(agentId) ?? `agent #${agentId}`;
}
