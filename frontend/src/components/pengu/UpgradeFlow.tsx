"use client";

import { useEffect, useState } from "react";
import { maxUint256 } from "viem";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { CONTRACTS, USDC, publicClient } from "@/lib/arc";
import {
  ABILITIES,
  CONTEST_TYPES,
  MAX_TIER,
  agentRegistryAbi,
  ctypeIndex,
  erc20Abi,
  fetchPrice,
  invalidateAgentsCache,
  tierOf,
  usdc,
  type AgentState,
  type ContestTypeName,
} from "@/lib/agents";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";

/// Upgrade modal reskinned to arcrun-redesign. Three flat ink-on-canvas
/// columns inside a bracketed shell, stencil headings, mono tier readouts,
/// flat pink tag CTA. No rounded pills, no shadows.

const NOTCH = "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)";

export function UpgradeFlow({
  open,
  onClose,
  agent,
  onUpgraded,
}: {
  open: boolean;
  onClose: () => void;
  agent: AgentState;
  onUpgraded: () => Promise<void> | void;
}) {
  const { address } = useOperatorAddress();
  const { writeContractAsync } = useArcWrite();
  const [prices, setPrices] = useState<Record<ContestTypeName, bigint | null>>({ scout: null, analyst: null, solver: null });
  const [busy, setBusy] = useState<ContestTypeName | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    let cancelled = false;
    void (async () => {
      const next: Record<ContestTypeName, bigint | null> = { scout: null, analyst: null, solver: null };
      for (const t of CONTEST_TYPES) {
        if (tierOf(agent, t) >= MAX_TIER) continue;
        try {
          next[t] = await fetchPrice(t, tierOf(agent, t));
        } catch {
          next[t] = null;
        }
      }
      if (!cancelled) setPrices(next);
    })();
    return () => { cancelled = true; };
  }, [open, agent]);

  async function doUpgrade(t: ContestTypeName) {
    if (!address) return;
    const cur = tierOf(agent, t);
    if (cur >= MAX_TIER) return;
    setBusy(t);
    setError(null);
    try {
      const price = await fetchPrice(t, cur);
      const allowance = (await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, CONTRACTS.AgentRegistry],
      })) as bigint;
      if (allowance < price) {
        const approveHash = await writeContractAsync({
          address: USDC,
          abi: erc20Abi,
          functionName: "approve",
          args: [CONTRACTS.AgentRegistry, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
      const upHash = await writeContractAsync({
        address: CONTRACTS.AgentRegistry,
        abi: agentRegistryAbi,
        functionName: "upgradeAgent",
        args: [BigInt(agent.id), ctypeIndex(t), cur + 1],
      });
      await publicClient.waitForTransactionReceipt({ hash: upHash });
      reportEvent("agent_upgrade", { context: { type: t, toTier: cur + 1 }, address });
      // Invalidate cache so onUpgraded's next fetchAgents reflects the new
      // tier instead of returning the pre-upgrade row.
      if (address) invalidateAgentsCache(address as `0x${string}`);
      await onUpgraded();
    } catch (e) {
      setError(friendlyError(e, "upgrade failed."));
      reportEvent("agent_upgrade_error", {
        level: "error",
        message: e instanceof Error ? e.message : String(e),
        context: { type: t },
        address,
      });
    } finally {
      setBusy(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-modal overflow-y-auto"
      style={{ backgroundColor: "rgba(27,17,18,0.55)" }}
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center px-4 py-12 sm:py-16">
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative my-auto w-full max-w-[820px] border border-ink bg-canvas p-6"
        >
          <Bracket pos="tl" /><Bracket pos="tr" /><Bracket pos="bl" /><Bracket pos="br" />

          <button
            onClick={onClose}
            aria-label="close"
            className="absolute right-4 top-4 font-mono text-base text-ink-3 hover:text-ink"
          >
            ✕
          </button>

          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> UPGRADE
          </div>
          <h2
            className="mt-3 font-stencil uppercase text-ink"
            style={{ fontSize: 28, lineHeight: 1, letterSpacing: "-0.01em" }}
          >
            UPGRADE YOUR AGENT
          </h2>
          <p className="mt-3 font-mono text-sm leading-[1.55] text-ink-2">
            pay USDC to raise a tier. you approve USDC once, then each upgrade is a single transaction.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {CONTEST_TYPES.map((t) => {
              const cur = tierOf(agent, t);
              const maxed = cur >= MAX_TIER;
              const price = prices[t];
              return (
                <div key={t} className="relative border border-[color:var(--hairline-strong)] bg-canvas p-5">
                  <div className="flex items-center justify-between">
                    <span className="font-stencil text-lg uppercase text-ink" style={{ letterSpacing: "-0.01em" }}>
                      {t.toUpperCase()}
                    </span>
                    <span className="border border-ink-3 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink">
                      TIER {cur}
                    </span>
                  </div>
                  {maxed ? (
                    <p className="mt-4 font-mono text-sm text-ink-2">
                      MAXED. {ABILITIES[t][cur]}
                    </p>
                  ) : (
                    <>
                      <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
                        NEXT, TIER {cur + 1}
                      </div>
                      <p className="mt-2 font-mono text-sm leading-[1.55] text-ink-2">{ABILITIES[t][cur + 1]}</p>
                      <div className="mt-4 font-stencil text-accent" style={{ fontSize: 24, lineHeight: 1 }}>
                        {price !== null ? usdc(price) : "…"}
                      </div>
                      <button
                        onClick={() => doUpgrade(t)}
                        disabled={busy !== null}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 bg-accent px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-60"
                        style={{ clipPath: NOTCH }}
                      >
                        {busy === t ? "UPGRADING…" : `UPGRADE TO TIER ${cur + 1}`} <span aria-hidden>→</span>
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {error ? <p className="mt-4 font-mono text-xs text-[color:var(--err)]">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

function Bracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const base = {
    position: "absolute" as const,
    width: 14,
    height: 14,
    pointerEvents: "none" as const,
  };
  const ink = "var(--ink)";
  const styles = {
    tl: { ...base, top: -1, left: -1, borderTop: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    tr: { ...base, top: -1, right: -1, borderTop: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
    bl: { ...base, bottom: -1, left: -1, borderBottom: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    br: { ...base, bottom: -1, right: -1, borderBottom: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
  };
  return <span aria-hidden style={styles[pos]} />;
}
