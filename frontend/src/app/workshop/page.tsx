"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { WorkshopScene } from "@/components/pengu/WorkshopScene";
import { UpgradeFlow } from "@/components/pengu/UpgradeFlow";
import { LoginCTA } from "@/components/pengu/LoginCTA";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { ABILITIES, CONTEST_TYPES, agentRegistryAbi, fetchFirstAgent, tierOf, type AgentState } from "@/lib/agents";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";

const chunkyBtn =
  "rounded-pill bg-pengu-blue px-6 py-3 font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6] active:translate-y-[3px] disabled:opacity-60";

export default function WorkshopPage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [agent, setAgent] = useState<AgentState | null | undefined>(undefined);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setAgent(null);
      return;
    }
    try {
      setAgent(await fetchFirstAgent(address));
    } catch {
      setAgent(null);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function claimAgent() {
    if (!address) return;
    setClaiming(true);
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
      await refresh();
    } catch (e) {
      setError(friendlyError(e, "could not claim your agent."));
      reportEvent("agent_create_error", { level: "error", message: e instanceof Error ? e.message : String(e), address });
    } finally {
      setClaiming(false);
    }
  }

  const level = agent ? Math.max(agent.scoutTier, agent.analystTier, agent.solverTier) : 0;

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pb-16 pt-12">
        <SectionLabel>workshop</SectionLabel>
        <h1 className="mt-5 font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">your workshop</h1>
        <p className="mt-3 max-w-[52ch] text-pengu-dark/65">
          your agent and its skills. upgrade a tier to compete harder across scout, analyst, and solver.
        </p>

        {!isConnected ? (
          <div className="mt-10 rounded-card border border-pengu-blue/15 bg-white p-8 text-center shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
            <p className="text-pengu-dark/65">connect a wallet to open your workshop and manage your agent.</p>
            <div className="mt-5 flex justify-center">
              <LoginCTA label="log in" className={chunkyBtn} />
            </div>
          </div>
        ) : agent === undefined ? (
          <p className="mt-10 font-mono text-sm text-pengu-dark/55">reading your agent from arc…</p>
        ) : agent === null ? (
          <div className="mt-10 rounded-card border border-pengu-blue/15 bg-white p-8 text-center shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
            <h2 className="font-bubble text-2xl uppercase text-pengu-dark">claim your agent</h2>
            <p className="mx-auto mt-2 max-w-[44ch] text-pengu-dark/65">
              you do not have an agent yet. claim a free default agent to start competing. this mints your onchain identity.
            </p>
            <button onClick={claimAgent} disabled={claiming} className={`mt-5 ${chunkyBtn}`}>
              {claiming ? "claiming…" : "claim agent"}
            </button>
            {error ? <p className="mt-4 font-mono text-xs text-[#e0466e]">{error}</p> : null}
          </div>
        ) : (
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <WorkshopScene level={level} />
            </div>
            <div className="rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
              <div className="font-display text-xs uppercase tracking-wide text-pengu-dark/40">agent #{agent.id}</div>
              <div className="mt-3 flex flex-col gap-3">
                {CONTEST_TYPES.map((t) => {
                  const cur = tierOf(agent, t);
                  return (
                    <div key={t} className="rounded-xl border border-pengu-blue/10 p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bubble text-base uppercase text-pengu-dark">{t}</span>
                        <span className="rounded-pill bg-pengu-blue/10 px-2.5 py-0.5 font-mono text-xs text-pengu-blue">tier {cur}</span>
                      </div>
                      <p className="mt-1 text-xs text-pengu-dark/55">{ABILITIES[t][cur]}</p>
                    </div>
                  );
                })}
              </div>
              <button onClick={() => setUpgradeOpen(true)} className={`mt-5 w-full ${chunkyBtn}`}>
                upgrade
              </button>
            </div>
          </div>
        )}
      </section>

      <Footer />

      {agent ? (
        <UpgradeFlow
          open={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          agent={agent}
          onUpgraded={async () => {
            await refresh();
            setUpgradeOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
