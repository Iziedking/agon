"use client";

import { useEffect, useState } from "react";
import type {
  ChallengeSettledMessage,
  ChallengeStandingsMessage,
  SettledMessage,
  StandingsMessage,
  WsMessage,
} from "@/lib/live";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8788";

/// Subscribes to the coordinator fanout and exposes the latest contest standings,
/// the latest challenge standings (peer challenges race too), and the settled
/// result. Auto-reconnects, so restarting the coordinator does not require a
/// page refresh. Browser-only.
export function useContestSocket() {
  const [connected, setConnected] = useState(false);
  const [standings, setStandings] = useState<StandingsMessage | null>(null);
  const [challengeStandings, setChallengeStandings] = useState<ChallengeStandingsMessage | null>(null);
  const [settled, setSettled] = useState<SettledMessage | null>(null);
  const [challengeSettled, setChallengeSettled] = useState<ChallengeSettledMessage | null>(null);

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
          if (msg.type === "contest_open") {
            // New contest: seed an empty board so it shows the instant it opens,
            // and clear the previous result so the win modal does not linger.
            setSettled(null);
            setStandings({
              type: "standings",
              contestId: msg.contestId,
              contestType: msg.contestType,
              endsAt: msg.endsAt,
              entries: [],
            });
          } else if (msg.type === "standings") {
            // Standings frames omit the type; keep the one from the open event.
            setStandings((prev) => ({
              ...msg,
              contestType:
                msg.contestType ?? (prev && prev.contestId === msg.contestId ? prev.contestType : undefined),
            }));
          } else if (msg.type === "challenge_standings") {
            setChallengeStandings(msg);
          } else if (msg.type === "settled") {
            setSettled(msg);
          } else if (msg.type === "challenge_settled") {
            setChallengeSettled(msg);
          }
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

  return { connected, standings, challengeStandings, settled, challengeSettled };
}
