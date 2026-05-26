"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useContestSocket } from "@/hooks/useContestSocket";
import { WinModal } from "@/components/WinModal";

/// Site-wide "you won" listener. Mounted in the root layout so it lives on every
/// page. Subscribes to the coordinator socket and pops the WinModal whenever a
/// contest settles with the connected wallet in the winners. Each contest fires
/// once and stays dismissed until the next one settles, so back-to-back rounds
/// from the autopilot each get their own celebration.
export function WinWatcher() {
  const { address } = useAccount();
  const { settled } = useContestSocket();
  const [shownFor, setShownFor] = useState<number | null>(null);

  // The autopilot runs contests back to back; reset the dismissed marker when a
  // new contest's settled frame arrives.
  useEffect(() => {
    if (settled && shownFor !== null && settled.contestId !== shownFor) {
      setShownFor(null);
    }
  }, [settled, shownFor]);

  const me = address?.toLowerCase();
  const youWon = !!settled && !!me && settled.winners.some((w) => w.operator.toLowerCase() === me);
  const show = youWon && settled && shownFor !== settled.contestId;

  return (
    <WinModal
      settled={show ? settled : null}
      youAddress={address}
      onClose={() => settled && setShownFor(settled.contestId)}
    />
  );
}
