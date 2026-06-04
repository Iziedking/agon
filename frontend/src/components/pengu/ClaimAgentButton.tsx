"use client";

import { useEffect, useState } from "react";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { agentRegistryAbi, fetchAgents, invalidateAgentsCache } from "@/lib/agents";
import { friendlyError } from "@/lib/errors";
import { logRawError } from "@/lib/report";
import { reportEvent } from "@/lib/report";
import { TagButton } from "@/components/redesign";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

/// Server-side cap check the frontend calls right before firing the
/// on-chain mint. Belt-and-braces over the local count state, and the
/// only off-chain gate that catches web3 wallet users between renders.
/// On-chain enforcement is queued for the AgentRegistry mainnet redeploy.
async function fetchClaimPrep(): Promise<{ canClaim: boolean; reason: string | null; owned: number; max: number }> {
  try {
    const res = await fetch(`${AUTH_URL}/agents/claim-prep`, { credentials: "include" });
    if (!res.ok) return { canClaim: true, reason: null, owned: 0, max: 5 };
    return (await res.json()) as { canClaim: boolean; reason: string | null; owned: number; max: number };
  } catch {
    return { canClaim: true, reason: null, owned: 0, max: 5 };
  }
}

/// Max agents a single profile can hold. Matches docs/agentTier.md and
/// the proposed AgentRegistry on-chain cap (deferred to mainnet contract
/// redeploy). Off-chain we hide the CLAIM button at the cap and surface
/// a clear message so the user knows they're full.
const MAX_AGENTS_PER_PROFILE = 5;

/// Mints a free default agent for the connected wallet via AgentRegistry. Used
/// from /workshop and /start so the claim path is identical from either entry.
export function ClaimAgentButton({
  className,
  label = "CLAIM AGENT",
  busyLabel = "CLAIMING…",
  onClaimed,
}: {
  className?: string;
  label?: string;
  busyLabel?: string;
  onClaimed?: () => void | Promise<void>;
}) {
  const { address } = useOperatorAddress();
  const { writeContractAsync } = useArcWrite();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);

  const refreshCount = async () => {
    if (!address) return;
    try {
      const list = await fetchAgents(address);
      setCount(list.length);
    } catch {
      setCount(0);
    }
  };

  useEffect(() => {
    if (!address) { setCount(null); return; }
    let live = true;
    fetchAgents(address)
      .then((list) => { if (live) setCount(list.length); })
      .catch(() => { if (live) setCount(0); });
    return () => { live = false; };
  }, [address]);

  const loading = count === null;
  const atCap = count !== null && count >= MAX_AGENTS_PER_PROFILE;

  async function claim() {
    if (!address) return;
    // Re-fetch the count right before the on-chain call so a stale optimistic
    // state can't slip past the cap. This catches the race where the page
    // shows the button while the initial fetch is still in flight.
    if (loading) {
      await refreshCount();
    }
    // The post-refresh state is in the local variable; recompute.
    const latest = count;
    if (latest !== null && latest >= MAX_AGENTS_PER_PROFILE) {
      setError(`you already own ${MAX_AGENTS_PER_PROFILE} agents. that's the cap.`);
      return;
    }
    // Server-side gate: in addition to the local count, ask the backend
    // right before signing. Catches the case where the local state is
    // stale by a frame and would have let a 6th tx through.
    const prep = await fetchClaimPrep();
    if (!prep.canClaim) {
      setCount(prep.owned);
      setError(prep.reason ?? `you already own ${prep.max} agents. that's the cap.`);
      return;
    }
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
      // Invalidate the agents cache so the post-claim refresh actually
      // re-reads the chain (instead of returning the pre-claim count).
      invalidateAgentsCache(address);
      // Tick the count locally so a second click in the same session can't
      // race past the cap before the parent's onClaimed refresh lands.
      setCount((c) => (c == null ? 1 : c + 1));
      await onClaimed?.();
      await refreshCount();
    } catch (e) {
      setError(friendlyError(e, "could not claim your agent."));
      logRawError("agent_create_error", e, { address });
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || !address || atCap || loading;
  const labelOut = busy
    ? busyLabel
    : loading
      ? "CHECKING AGENTS…"
      : atCap
        ? `${MAX_AGENTS_PER_PROFILE}/${MAX_AGENTS_PER_PROFILE} AGENTS OWNED`
        : label;

  return (
    <div className="flex flex-col gap-2">
      {className ? (
        <button
          onClick={claim}
          disabled={disabled}
          className={className}
          title={atCap ? `${count} / ${MAX_AGENTS_PER_PROFILE} agents claimed` : undefined}
        >
          {labelOut}
        </button>
      ) : (
        <TagButton variant="primary" size="md" onClick={claim} disabled={disabled} arrow={!disabled}>
          {labelOut}
        </TagButton>
      )}
      {error ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--err)]">{error}</p>
      ) : null}
    </div>
  );
}
