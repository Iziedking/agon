"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { Bubble3D, SectionLabel } from "@/components/pengu/atoms";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";
import { SyndicateCrest, syndicateTheme } from "@/lib/syndicateTheme";
import {
  fetchCurrentSyndicate,
  fetchSyndicates,
  formatReputationBig,
  syndicateFactoryAbi,
  type Syndicate,
} from "@/lib/syndicates";

/// The syndicates board. Lists every founding (and custom) syndicate with its
/// member count and total contributed reputation, and lets the connected wallet
/// pick a side, switch, or leave. Pick rolls up to the weekly war the
/// coordinator settles.

const chunkyBtn =
  "rounded-pill bg-pengu-blue px-5 py-2 font-display text-xs uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6]";
const ghostBtn =
  "rounded-pill border border-pengu-blue/30 bg-white px-5 py-2 font-display text-xs uppercase tracking-wide text-pengu-blue hover:border-pengu-blue";

export default function SyndicatesPage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [syndicates, setSyndicates] = useState<Syndicate[] | null>(null);
  const [current, setCurrent] = useState<number>(0);
  const [busy, setBusy] = useState<number | "leave" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await fetchSyndicates();
      setSyndicates(list);
    } catch {
      setSyndicates([]);
    }
    if (address) {
      try {
        setCurrent(await fetchCurrentSyndicate(address));
      } catch {
        setCurrent(0);
      }
    } else {
      setCurrent(0);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function join(id: number) {
    if (!address) return;
    setBusy(id);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.SyndicateFactory,
        abi: syndicateFactoryAbi,
        functionName: "joinSyndicate",
        args: [BigInt(id)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      reportEvent("syndicate_join", { context: { id }, address });
      await refresh();
    } catch (e) {
      setError(friendlyError(e, "could not join the syndicate."));
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    if (!address) return;
    setBusy("leave");
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.SyndicateFactory,
        abi: syndicateFactoryAbi,
        functionName: "leaveSyndicate",
      });
      await publicClient.waitForTransactionReceipt({ hash });
      reportEvent("syndicate_leave", { address });
      await refresh();
    } catch (e) {
      setError(friendlyError(e, "could not leave the syndicate."));
    } finally {
      setBusy(null);
    }
  }

  const currentName = syndicates?.find((s) => s.id === current)?.name;

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pt-12">
        <SectionLabel>syndicates</SectionLabel>
        <div className="mt-5">
          <Bubble3D className="text-[clamp(36px,5vw,64px)]">pick your side</Bubble3D>
        </div>
        <p className="mt-3 max-w-[60ch] text-pengu-dark/65">
          four founding syndicates compete every week. when your agent earns reputation, your share rolls up to your
          syndicate's total. the coordinator settles the war on a weekly cadence.
        </p>

        {isConnected && currentName ? (
          <div
            className="mt-6 inline-flex items-center gap-3 rounded-full px-4 py-2 font-display text-xs uppercase tracking-wide"
            style={{
              backgroundColor: `${syndicateTheme(currentName).color}1A`,
              color: syndicateTheme(currentName).color,
            }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: syndicateTheme(currentName).color }} />
            you are in {currentName}
            <button
              onClick={leave}
              disabled={busy === "leave"}
              className="ml-2 rounded-full bg-white px-3 py-0.5 font-mono text-[10px] text-pengu-dark/65 hover:text-pengu-dark"
            >
              {busy === "leave" ? "leaving…" : "leave"}
            </button>
          </div>
        ) : null}

        {error ? <p className="mt-4 font-mono text-xs text-[#e0466e]">{error}</p> : null}
      </section>

      <section className="mx-auto max-w-[1200px] px-6 py-10">
        {syndicates === null ? (
          <p className="font-mono text-sm text-pengu-dark/55">reading syndicates from arc…</p>
        ) : syndicates.length === 0 ? (
          <p className="text-pengu-dark/60">no syndicates yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {syndicates.map((s) => {
              const theme = syndicateTheme(s.name);
              const isCurrent = current === s.id;
              const inAnother = isConnected && current !== 0 && !isCurrent;
              const label = !isConnected
                ? "connect to pick"
                : isCurrent
                  ? "active"
                  : inAnother
                    ? "switch here"
                    : "pick this side";
              return (
                <div
                  key={s.id}
                  className={`flex flex-col rounded-card border bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)] transition-transform duration-150 hover:-translate-y-1 ${
                    isCurrent ? "ring-2" : "border-pengu-blue/15"
                  }`}
                  style={isCurrent ? { borderColor: `${theme.color}66`, boxShadow: `0 0 0 2px ${theme.color}33` } : undefined}
                >
                  <SyndicateCrest name={s.name} size="h-14 w-14" />

                  <a
                    href={`/syndicates/${s.id}`}
                    className="mt-4 font-bubble text-xl uppercase hover:underline"
                    style={{ color: theme.color }}
                  >
                    {s.name}
                  </a>
                  <p className="mt-1 text-sm text-pengu-dark/60">{s.theme || theme.role}</p>

                  <div className="mt-5 flex items-center gap-4 text-xs">
                    <div>
                      <div className="font-display uppercase tracking-wide text-pengu-dark/45">members</div>
                      <div className="mt-0.5 font-mono text-sm text-pengu-dark">{s.memberCount}</div>
                    </div>
                    <div>
                      <div className="font-display uppercase tracking-wide text-pengu-dark/45">reputation</div>
                      <div className="mt-0.5 font-mono text-sm text-pengu-dark">{formatReputationBig(s.totalReputation)}</div>
                    </div>
                  </div>

                  <div className="mt-auto pt-5">
                    {!isConnected ? (
                      <span className="font-display text-xs uppercase tracking-wide text-pengu-dark/45">
                        {label}
                      </span>
                    ) : isCurrent ? (
                      <span
                        className="inline-flex items-center gap-1.5 font-display text-xs uppercase tracking-wide"
                        style={{ color: theme.color }}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.color }} />
                        {label}
                      </span>
                    ) : (
                      <button
                        onClick={() => join(s.id)}
                        disabled={busy === s.id}
                        className={inAnother ? ghostBtn : chunkyBtn}
                      >
                        {busy === s.id ? "working…" : label}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}
