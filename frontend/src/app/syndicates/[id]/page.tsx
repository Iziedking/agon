"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAccount, useWriteContract } from "wagmi";
import { useOperatorAddress } from "@/hooks/useAuth";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { Bubble3D, SectionLabel } from "@/components/pengu/atoms";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";
import { SyndicateCrest, syndicateTheme } from "@/lib/syndicateTheme";
import {
  fetchCurrentSyndicate,
  fetchMembership,
  fetchSyndicate,
  formatReputationBig,
  syndicateFactoryAbi,
  type Membership,
  type Syndicate,
} from "@/lib/syndicates";

/// One syndicate, end to end: name and theme, member count, reputation rolled
/// up across the team, the connected operator's contribution if they're in it,
/// and join/leave/switch actions.

const chunkyBtn =
  "rounded-pill bg-pengu-blue px-6 py-3 font-display text-sm uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6]";
const ghostBtn =
  "rounded-pill border border-pengu-blue/30 bg-pengu-card px-6 py-3 font-display text-sm uppercase tracking-wide text-pengu-blue hover:border-pengu-blue";

export default function SyndicateDetail() {
  const params = useParams();
  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number(raw);
  const valid = Number.isFinite(id) && id > 0;

  const { address, isSignedIn: isConnected } = useOperatorAddress();
  const { writeContractAsync } = useWriteContract();

  const [syndicate, setSyndicate] = useState<Syndicate | null | undefined>(undefined);
  const [current, setCurrent] = useState<number>(0);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [busy, setBusy] = useState<"join" | "leave" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!valid) return;
    try {
      setSyndicate(await fetchSyndicate(id));
    } catch {
      setSyndicate(null);
    }
    if (address) {
      try {
        setCurrent(await fetchCurrentSyndicate(address));
      } catch {
        setCurrent(0);
      }
      try {
        setMembership(await fetchMembership(id, address));
      } catch {
        setMembership(null);
      }
    } else {
      setCurrent(0);
      setMembership(null);
    }
  }, [valid, id, address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function join() {
    if (!valid || !address) return;
    setBusy("join");
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
      setError(friendlyError(e, "could not leave."));
    } finally {
      setBusy(null);
    }
  }

  if (!valid) {
    return (
      <Shell>
        <section className="mx-auto max-w-[720px] px-6 pb-16 pt-12">
          <SectionLabel>syndicates</SectionLabel>
          <p className="mt-6 text-pengu-dark/65">that syndicate id is not valid.</p>
        </section>
      </Shell>
    );
  }

  if (syndicate === undefined) {
    return (
      <Shell>
        <section className="mx-auto max-w-[720px] px-6 pb-16 pt-12">
          <SectionLabel>syndicates</SectionLabel>
          <p className="mt-6 font-mono text-sm text-pengu-dark/55">reading the syndicate…</p>
        </section>
      </Shell>
    );
  }

  if (syndicate === null) {
    return (
      <Shell>
        <section className="mx-auto max-w-[720px] px-6 pb-16 pt-12">
          <SectionLabel>syndicates</SectionLabel>
          <p className="mt-6 text-pengu-dark/65">syndicate #{id} does not exist on arc.</p>
          <a href="/syndicates" className="mt-3 inline-block font-display text-xs uppercase text-pengu-blue hover:underline">
            ← all syndicates
          </a>
        </section>
      </Shell>
    );
  }

  const theme = syndicateTheme(syndicate.name);
  const isCurrent = current === syndicate.id;
  const inAnother = isConnected && current !== 0 && !isCurrent;

  return (
    <Shell>
      <section className="mx-auto max-w-[900px] px-6 pt-12">
        <a href="/syndicates" className="font-display text-xs uppercase tracking-wide text-pengu-blue hover:underline">
          ← all syndicates
        </a>

        <div className="mt-5 flex flex-wrap items-center gap-5">
          <SyndicateCrest name={syndicate.name} size="h-20 w-20" />
          <div className="min-w-0 flex-1">
            <SectionLabel>syndicate #{syndicate.id}</SectionLabel>
            <div className="mt-3" style={{ color: theme.color }}>
              <Bubble3D className="text-[clamp(32px,5vw,52px)]">{syndicate.name}</Bubble3D>
            </div>
            <p className="mt-2 text-pengu-dark/65">{syndicate.theme || theme.role}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[900px] px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="members" value={String(syndicate.memberCount)} />
          <Stat label="reputation" value={String(formatReputationBig(syndicate.totalReputation))} />
          <Stat label="kind" value={syndicate.isCustom ? "custom" : "founding"} />
        </div>
      </section>

      <section className="mx-auto max-w-[900px] px-6 pb-8">
        <div className="rounded-card border border-pengu-blue/15 bg-pengu-card p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
          {!isConnected ? (
            <p className="text-pengu-dark/65">connect your wallet to pick this side.</p>
          ) : isCurrent ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-display text-xs uppercase tracking-wide" style={{ color: theme.color }}>
                    you are in
                  </div>
                  <div className="mt-1 font-bubble text-xl uppercase" style={{ color: theme.color }}>
                    {syndicate.name}
                  </div>
                </div>
                <button onClick={leave} disabled={busy === "leave"} className={ghostBtn}>
                  {busy === "leave" ? "leaving…" : "leave syndicate"}
                </button>
              </div>
              {membership ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Stat label="your contribution" value={String(formatReputationBig(membership.contribution))} />
                  <Stat
                    label="joined"
                    value={
                      membership.joinedAt ? new Date(membership.joinedAt * 1000).toLocaleDateString() : "—"
                    }
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[48ch] text-pengu-dark/65">
                {inAnother
                  ? "you're in a different syndicate. joining this one switches you over."
                  : "pick this side and your future reputation rolls into this syndicate's total."}
              </p>
              <button onClick={join} disabled={busy === "join"} className={chunkyBtn}>
                {busy === "join" ? "working…" : inAnother ? "switch here" : "pick this side"}
              </button>
            </div>
          )}

          {error ? <p className="mt-4 font-mono text-xs text-[#e0466e]">{error}</p> : null}
        </div>
      </section>

      <section className="mx-auto max-w-[900px] px-6 pb-16">
        <SectionLabel>weekly war</SectionLabel>
        <div className="mt-4 rounded-card border border-pengu-blue/15 bg-pengu-card p-6 shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
          <p className="text-sm text-pengu-dark/65">
            every week, the coordinator settles the syndicate war: total contributions across the seven days,
            standings emitted on-chain. the war pool distribution is a v1 refinement.
          </p>
        </div>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-pengu-dark">
      <AppHeader />
      {children}
      <Footer />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-pengu-blue/15 bg-pengu-card px-5 py-4 shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
      <div className="font-display text-[11px] uppercase tracking-wide text-pengu-dark/45">{label}</div>
      <div className="mt-1 font-mono text-2xl text-pengu-dark">{value}</div>
    </div>
  );
}
