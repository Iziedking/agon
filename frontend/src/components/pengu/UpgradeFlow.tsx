"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { maxUint256 } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { CONTRACTS, USDC, publicClient } from "@/lib/arc";
import {
  ABILITIES,
  CONTEST_TYPES,
  MAX_TIER,
  agentRegistryAbi,
  ctypeIndex,
  erc20Abi,
  fetchPrice,
  tierOf,
  usdc,
  type AgentState,
  type ContestTypeName,
} from "@/lib/agents";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";

/// Upgrade modal: the three contest types side by side with cost and the next
/// ability. Approve USDC once, then each upgrade is a single transaction.
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
  const reduce = useReducedMotion();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
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
    return () => {
      cancelled = true;
    };
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-modal flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(27,17,64,0.55)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="relative w-full max-w-[760px] rounded-[28px] border-2 border-pengu-dark/5 bg-white p-8 shadow-[0_30px_80px_rgba(27,17,64,0.35)]"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: reduce ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={onClose} aria-label="close" className="absolute right-5 top-5 text-xl leading-none text-pengu-dark/30 hover:text-pengu-dark">
              ✕
            </button>
            <h2 className="font-bubble text-3xl uppercase leading-none text-pengu-dark">upgrade your agent</h2>
            <p className="mt-2 text-sm text-pengu-dark/65">
              pay usdc to raise a tier. you approve usdc once, then each upgrade is a single transaction.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {CONTEST_TYPES.map((t) => {
                const cur = tierOf(agent, t);
                const maxed = cur >= MAX_TIER;
                const price = prices[t];
                return (
                  <div key={t} className="rounded-card border border-pengu-blue/15 bg-white p-5 shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
                    <div className="flex items-center justify-between">
                      <span className="font-bubble text-lg uppercase text-pengu-dark">{t}</span>
                      <span className="rounded-pill bg-pengu-blue/10 px-2.5 py-1 font-mono text-xs text-pengu-blue">tier {cur}</span>
                    </div>
                    {maxed ? (
                      <p className="mt-4 text-sm text-pengu-dark/55">maxed for v0. {ABILITIES[t][cur]}.</p>
                    ) : (
                      <>
                        <p className="mt-3 font-display text-[11px] uppercase tracking-wide text-pengu-dark/40">next, tier {cur + 1}</p>
                        <p className="mt-1 text-sm text-pengu-dark/70">{ABILITIES[t][cur + 1]}</p>
                        <div className="mt-4 font-mono text-lg text-pengu-blue">{price !== null ? usdc(price) : "…"}</div>
                        <button
                          onClick={() => doUpgrade(t)}
                          disabled={busy !== null}
                          className="mt-4 w-full rounded-pill bg-pengu-blue px-5 py-3 font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60"
                        >
                          {busy === t ? "upgrading…" : `upgrade to tier ${cur + 1}`}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {error ? <p className="mt-4 font-mono text-xs text-[#e0466e]">{error}</p> : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
