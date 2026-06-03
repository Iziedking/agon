"use client";

import { useEffect, useState } from "react";
import type {
  ChallengeSettledMessage,
  ChallengeStandingsMessage,
  ContestOpenMessage,
  SettledMessage,
  StandingsMessage,
  TickMessage,
  WsMessage,
} from "@/lib/live";

type PinnedArcanaMarketSet = {
  contestId: number;
  markets: NonNullable<ContestOpenMessage["arcanaMarkets"]>;
};

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
  /// Arcana markets pinned to the current contest, attached by the coordinator
  /// at contest_open. Lets the live page render the round's market menu from
  /// the instant the contest opens, before any agent has placed a trade.
  const [pinnedArcana, setPinnedArcana] = useState<PinnedArcanaMarketSet | null>(null);
  /// Most recent prediction tick. Lightweight WS hint from the tick
  /// scheduler; the next standings frame carries the authoritative state.
  const [lastTick, setLastTick] = useState<TickMessage | null>(null);

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
            // Carry the pinned market set (if any) so the live page can show
            // the round's menu pre-entries. Clear it when a contest_open
            // arrives without one (non-Arcana contest taking over the slot).
            if (msg.arcanaMarkets && msg.arcanaMarkets.length > 0) {
              setPinnedArcana({ contestId: msg.contestId, markets: msg.arcanaMarkets });
            } else {
              setPinnedArcana(null);
            }
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
          } else if (msg.type === "tick") {
            setLastTick(msg);
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

  return {
    connected,
    standings,
    challengeStandings,
    settled,
    challengeSettled,
    pinnedArcana,
    lastTick,
  };
}
