"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useContestSocket } from "@/hooks/useContestSocket";
import { WinShareModal } from "@/components/redesign/WinShareModal";

/// Site-wide "you placed" listener. Mounted in the root layout so it lives on
/// every page. Subscribes to the coordinator socket and pops the win-share
/// card whenever a contest OR challenge settles with the connected wallet in
/// the winner list. Each settlement fires once; back-to-back rounds from the
/// autopilot each get their own pop.
export function WinWatcher() {
  const { address } = useAccount();
  const { settled, challengeSettled } = useContestSocket();

  // Track which contest / challenge id we last showed for so the modal
  // doesn't re-pop after the user closes it. A new id resets.
  const [shownContest, setShownContest] = useState<number | null>(null);
  const [shownChallenge, setShownChallenge] = useState<number | null>(null);

  useEffect(() => {
    if (settled && shownContest !== null && settled.contestId !== shownContest) {
      setShownContest(null);
    }
  }, [settled, shownContest]);
  useEffect(() => {
    if (challengeSettled && shownChallenge !== null && challengeSettled.challengeId !== shownChallenge) {
      setShownChallenge(null);
    }
  }, [challengeSettled, shownChallenge]);

  const me = address?.toLowerCase();

  // Pick whichever just landed and contains the wallet — if both land near
  // each other, contest wins the slot first; the next one queues up after
  // dismiss because its `shownX` is still null.
  const pick = useMemo(() => {
    if (!me) return null;
    if (settled && shownContest !== settled.contestId) {
      const won = settled.winners.some((w) => w.operator.toLowerCase() === me);
      if (won) {
        return {
          source: "contest" as const,
          id: settled.contestId,
          winners: settled.winners,
          dismiss: () => setShownContest(settled.contestId),
        };
      }
    }
    if (challengeSettled && shownChallenge !== challengeSettled.challengeId) {
      const won = challengeSettled.winners.some((w) => w.operator.toLowerCase() === me);
      if (won) {
        return {
          source: "challenge" as const,
          id: challengeSettled.challengeId,
          winners: challengeSettled.winners,
          dismiss: () => setShownChallenge(challengeSettled.challengeId),
        };
      }
    }
    return null;
  }, [me, settled, shownContest, challengeSettled, shownChallenge]);

  if (!pick || !address) return null;

  return (
    <WinShareModal
      source={pick.source}
      id={pick.id}
      winners={pick.winners}
      youAddress={address}
      onClose={pick.dismiss}
    />
  );
}
