"use client";

import { useEffect, useState } from "react";
import type { SettledMessage, StandingsMessage, WsMessage } from "@/lib/live";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8788";

/// Subscribes to the coordinator fanout and exposes the latest standings and the
/// settled result. Auto-reconnects, so restarting the coordinator does not
/// require a page refresh. Browser-only.
export function useContestSocket() {
  const [connected, setConnected] = useState(false);
  const [standings, setStandings] = useState<StandingsMessage | null>(null);
  const [settled, setSettled] = useState<SettledMessage | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as WsMessage;
          if (msg.type === "standings") setStandings(msg);
          else if (msg.type === "settled") setSettled(msg);
        } catch {
          // ignore malformed frames
        }
      };
    }

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return { connected, standings, settled };
}
