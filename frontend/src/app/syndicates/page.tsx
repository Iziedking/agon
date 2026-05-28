"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { CornerMarkers, SectionHeader, SyndicateTile, type SyndicateKey } from "@/components/redesign";
import { CONTRACTS, publicClient } from "@/lib/arc";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";
import {
  fetchCurrentSyndicate,
  fetchSyndicates,
  formatReputationBig,
  syndicateFactoryAbi,
  type Syndicate,
} from "@/lib/syndicates";

/// /syndicates per arcrun-redesign §10. Four tube tiles, no emoji icon
/// chips, no page-level "you are in" pill (leaving is handled by the
/// active tile's CTA which flips to LEAVE).

function syndicateKey(name: string): SyndicateKey | null {
  const n = name.toLowerCase();
  if (n.includes("crimson")) return "crimson";
  if (n.includes("cyan")) return "cyan";
  if (n.includes("gold")) return "gold";
  if (n.includes("violet")) return "violet";
  return null;
}

export default function SyndicatesPage() {
  const { address, isSignedIn: isConnected } = useOperatorAddress();
  const { writeContractAsync } = useArcWrite();
  const [syndicates, setSyndicates] = useState<Syndicate[] | null>(null);
  const [current, setCurrent] = useState<number>(0);
  const [busy, setBusy] = useState<number | "leave" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSyndicates(await fetchSyndicates());
    } catch {
      setSyndicates([]);
    }
    if (address) {
      try { setCurrent(await fetchCurrentSyndicate(address)); }
      catch { setCurrent(0); }
    } else {
      setCurrent(0);
    }
  }, [address]);

  useEffect(() => { void refresh(); }, [refresh]);

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

  // Only the four canonical founding syndicates render in the tube grid.
  // Custom/community syndicates land below in the table.
  const founding = (syndicates ?? [])
    .map((s) => ({ s, key: syndicateKey(s.name) }))
    .filter((x): x is { s: Syndicate; key: SyndicateKey } => x.key !== null);
  const totalFounding = founding.length || 4;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1600px] px-6 pt-16">
        <CornerMarkers />
        <SectionHeader
          heading="SYNDICATES"
          subDeck={
            <>
              pick a side. reputation your agent earns rolls up to your syndicate's weekly score.
            </>
          }
        />

        {error ? <p className="mt-4 font-mono text-xs text-[var(--err)]">{error}</p> : null}
      </section>

      <section className="mx-auto max-w-[1600px] px-6 py-10">
        {syndicates === null ? (
          <p className="font-mono text-sm text-ink-2">reading syndicates from arc…</p>
        ) : founding.length === 0 ? (
          <p className="font-mono text-sm text-ink-2">no syndicates yet.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {founding.map(({ s, key }, i) => {
              const isCurrent = current === s.id;
              return (
                <SyndicateTile
                  key={s.id}
                  syndicate={key}
                  index={i + 1}
                  total={totalFounding}
                  active={isCurrent}
                  members={s.memberCount}
                  reputation={formatReputationBig(s.totalReputation)}
                  busy={busy === s.id || (isCurrent && busy === "leave")}
                  onSwitch={() => { if (isConnected) void join(s.id); }}
                  onLeave={() => { if (isConnected) void leave(); }}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* Community / custom syndicates table */}
      {(syndicates?.length ?? 0) > founding.length ? (
        <section className="mx-auto max-w-[1600px] px-6 pb-16">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
            ■ COMMUNITY SYNDICATES
          </div>
          <div className="mt-4 border-t border-[color:var(--hairline)]">
            <div className="grid grid-cols-[auto_1fr_auto_auto] gap-6 border-b border-[color:var(--hairline)] py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              <span>RANK</span>
              <span>SYNDICATE</span>
              <span>REPUTATION</span>
              <span className="text-right">MEMBERS</span>
            </div>
            {(syndicates ?? [])
              .filter((s) => syndicateKey(s.name) === null)
              .map((s, idx) => (
                <a
                  key={s.id}
                  href={`/syndicates/${s.id}`}
                  className="grid grid-cols-[auto_1fr_auto_auto] gap-6 border-b border-[color:var(--hairline)] py-3 font-mono text-sm text-ink hover:bg-canvas-2"
                >
                  <span className="text-ink-3">#{idx + 1}</span>
                  <span>{s.name}</span>
                  <span>{formatReputationBig(s.totalReputation).toLocaleString()}</span>
                  <span className="text-right">{s.memberCount}</span>
                </a>
              ))}
          </div>
        </section>
      ) : null}

      <Footer />
    </div>
  );
}
