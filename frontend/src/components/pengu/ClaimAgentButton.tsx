"use client";

import { useState } from "react";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { agentRegistryAbi } from "@/lib/agents";
import { friendlyError, rawErrorDetail } from "@/lib/errors";
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
  const [error, setError] = useState<{ friendly: string; raw: string } | null>(null);

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
      setError({
        friendly: friendlyError(e, "could not claim your agent."),
        raw: rawErrorDetail(e),
      });
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
      {error ? (
        <div>
          <p className="font-mono text-xs text-[#e0466e]">{error.friendly}</p>
          {error.raw && error.raw !== error.friendly ? (
            <p className="mt-1 font-mono text-[10px] leading-[1.4] text-ink-3 break-words">
              <span className="text-ink-2">details:</span> {error.raw}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
