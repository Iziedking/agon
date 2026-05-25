"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { LiveContestPanel } from "@/components/LiveContestPanel";
import { WinModal } from "@/components/WinModal";
import { useContestSocket } from "@/hooks/useContestSocket";

export default function LivePage() {
  const { connected, standings, settled } = useContestSocket();
  const { address } = useAccount();
  const [dismissed, setDismissed] = useState(false);

  return (
    <div className="wrap">
      <nav className="nav">
        <a className="wordmark" href="/">
          Arc<span>Run</span>
        </a>
        <div className="nav-links">
          <a href="/contests">Contests</a>
          <ConnectButton />
        </div>
      </nav>

      <div className="section-head">
        <h1>Live</h1>
        <span className="mono muted">{connected ? "feed connected" : "feed offline"}</span>
      </div>

      <LiveContestPanel standings={standings} connected={connected} />

      <WinModal settled={dismissed ? null : settled} youAddress={address} onClose={() => setDismissed(true)} />
    </div>
  );
}
