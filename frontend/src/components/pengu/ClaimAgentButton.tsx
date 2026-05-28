"use client";

import { useState } from "react";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { agentRegistryAbi } from "@/lib/agents";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";

/// Mints a free default agent for the connected wallet via AgentRegistry. Used
/// from /workshop and /start so the claim path is identical from either entry.
export function ClaimAgentButton({
  className,
  label = "claim agent",
  busyLabel = "claiming…",
  onClaimed,
}: {
  className: string;
  label?: string;
  busyLabel?: string;
  onClaimed?: () => void | Promise<void>;
}) {
  const { address } = useOperatorAddress();
  const { writeContractAsync } = useArcWrite();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.AgentRegistry,
        abi: agentRegistryAbi,
        functionName: "createAgent",
        args: ["arcrun://agent/v1"],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      reportEvent("agent_created", { address });
      await onClaimed?.();
    } catch (e) {
      setError(friendlyError(e, "could not claim your agent."));
      reportEvent("agent_create_error", {
        level: "error",
        message: e instanceof Error ? e.message : String(e),
        address,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button onClick={claim} disabled={busy || !address} className={className}>
        {busy ? busyLabel : label}
      </button>
      {error ? <p className="font-mono text-xs text-[#e0466e]">{error}</p> : null}
    </div>
  );
}
