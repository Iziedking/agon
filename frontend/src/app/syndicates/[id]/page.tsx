"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { BracketedCell, TagButton } from "@/components/redesign";
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

export default function SyndicateDetail() {
  const params = useParams();
  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number(raw);
  const valid = Number.isFinite(id) && id > 0;

  const { address, isSignedIn: isConnected } = useOperatorAddress();
  const { writeContractAsync } = useArcWrite();

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
          <Eyebrow>SYNDICATES</Eyebrow>
          <p className="mt-6 font-mono text-[14px] text-ink-2">that syndicate id is not valid.</p>
        </section>
      </Shell>
    );
  }

  if (syndicate === undefined) {
    return (
      <Shell>
        <section className="mx-auto max-w-[720px] px-6 pb-16 pt-12">
          <Eyebrow>SYNDICATES</Eyebrow>
          <p className="mt-6 font-mono text-[12px] uppercase tracking-[0.12em] text-ink-3">READING THE SYNDICATE…</p>
        </section>
      </Shell>
    );
  }

  if (syndicate === null) {
    return (
      <Shell>
        <section className="mx-auto max-w-[720px] px-6 pb-16 pt-12">
          <Eyebrow>SYNDICATES</Eyebrow>
          <p className="mt-6 font-mono text-[14px] text-ink-2">syndicate #{id} does not exist on arc.</p>
          <a
            href="/syndicates"
            className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.12em] text-accent hover:underline"
          >
            ← ALL SYNDICATES
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
        <a
          href="/syndicates"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent hover:underline"
        >
          ← ALL SYNDICATES
        </a>

        <div className="mt-5 flex flex-wrap items-center gap-5">
          <SyndicateCrest name={syndicate.name} size="h-20 w-20" />
          <div className="min-w-0 flex-1">
            <Eyebrow>SYNDICATE #{syndicate.id}</Eyebrow>
            <h1
              className="mt-3 font-stencil uppercase"
              style={{
                color: theme.color,
                fontSize: "clamp(32px, 5vw, 52px)",
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
            >
              {syndicate.name.toUpperCase()}
            </h1>
            <p className="mt-2 font-mono text-[14px] text-ink-2">{syndicate.theme || theme.role}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[900px] px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="MEMBERS" value={String(syndicate.memberCount)} />
          <Stat label="REPUTATION" value={String(formatReputationBig(syndicate.totalReputation))} />
          <Stat label="KIND" value={syndicate.isCustom ? "CUSTOM" : "FOUNDING"} />
        </div>
      </section>

      <section className="mx-auto max-w-[900px] px-6 pb-8">
        <BracketedCell pad="md">
          {!isConnected ? (
            <p className="font-mono text-[14px] text-ink-2">connect your wallet to pick this side.</p>
          ) : isCurrent ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div
                    className="font-mono text-[11px] uppercase tracking-[0.16em]"
                    style={{ color: theme.color }}
                  >
                    YOU ARE IN
                  </div>
                  <div
                    className="mt-1 font-stencil uppercase"
                    style={{
                      color: theme.color,
                      fontSize: 22,
                      lineHeight: 1,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {syndicate.name.toUpperCase()}
                  </div>
                </div>
                <TagButton
                  variant="ghost"
                  size="md"
                  onClick={leave}
                  disabled={busy === "leave"}
                  arrow={busy !== "leave"}
                >
                  {busy === "leave" ? "LEAVING…" : "LEAVE SYNDICATE"}
                </TagButton>
              </div>
              {membership ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Stat
                    label="YOUR CONTRIBUTION"
                    value={String(formatReputationBig(membership.contribution))}
                  />
                  <Stat
                    label="JOINED"
                    value={
                      membership.joinedAt
                        ? new Date(membership.joinedAt * 1000).toLocaleDateString()
                        : "—"
                    }
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[48ch] font-mono text-[14px] leading-[1.55] text-ink-2">
                {inAnother
                  ? "you're in a different syndicate. joining this one switches you over."
                  : "pick this side and your future reputation rolls into this syndicate's total."}
              </p>
              <TagButton
                variant="primary"
                size="md"
                onClick={join}
                disabled={busy === "join"}
                arrow={busy !== "join"}
              >
                {busy === "join" ? "WORKING…" : inAnother ? "SWITCH HERE" : "PICK THIS SIDE"}
              </TagButton>
            </div>
          )}

          {error ? (
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--err)]">
              {error}
            </p>
          ) : null}
        </BracketedCell>
      </section>

      <section className="mx-auto max-w-[900px] px-6 pb-16">
        <Eyebrow>WEEKLY WAR</Eyebrow>
        <div className="mt-4">
          <BracketedCell pad="md">
            <p className="font-mono text-[14px] leading-[1.55] text-ink-2">
              every week, the coordinator settles the syndicate war: total contributions across the seven days,
              standings emitted on-chain. the war pool distribution is a v1 refinement.
            </p>
          </BracketedCell>
        </div>
      </section>
    </Shell>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
      <span aria-hidden className="text-accent">■</span> {children}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-ink">
      <AppHeader />
      {children}
      <Footer />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{label}</div>
      <div
        className="mt-1 font-stencil text-ink"
        style={{ fontSize: 24, lineHeight: 1.05, letterSpacing: "-0.01em" }}
      >
        {value}
      </div>
    </BracketedCell>
  );
}
