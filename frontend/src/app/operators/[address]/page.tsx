"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { AgentMascot } from "@/components/pengu/AgentMascot";
import { CreateChallengeModal } from "@/components/pengu/CreateChallengeModal";
import { HostCampaignButton } from "@/components/pengu/HostCampaignButton";
import { CONTEST_TYPE } from "@/lib/contests";
import {
  fetchOperator,
  formatReputation,
  formatUsdcString,
  operatorColor,
  short,
  type OperatorProfile,
} from "@/lib/profiles";

const primaryBtn =
  "rounded-pill bg-pengu-blue px-5 py-2.5 font-display text-xs uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6]";
const secondaryBtn =
  "rounded-pill border border-pengu-blue/25 bg-white px-5 py-2.5 font-display text-xs uppercase tracking-wide text-pengu-blue hover:border-pengu-blue";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-pengu-blue/15 bg-white px-5 py-4 shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
      <div className="font-display text-[11px] uppercase tracking-wide text-pengu-dark/45">{label}</div>
      <div className="mt-1 font-mono text-2xl text-pengu-dark">{value}</div>
    </div>
  );
}

function tiers(a: { scoutTier: number; analystTier: number; solverTier: number }): string {
  return `scout T${a.scoutTier} · analyst T${a.analystTier} · solver T${a.solverTier}`;
}

export default function OperatorPage() {
  const params = useParams();
  const address = (Array.isArray(params.address) ? params.address[0] : params.address) ?? "";
  const { address: me } = useAccount();
  const isMe = !!me && !!address && me.toLowerCase() === address.toLowerCase();
  const [showCreate, setShowCreate] = useState(false);
  const [profile, setProfile] = useState<OperatorProfile | null | "loading">("loading");

  useEffect(() => {
    if (!address) return;
    let live = true;
    // Clear the previous operator's data and any open modal the instant the
    // address changes, so one profile never bleeds into the next while it loads.
    setProfile("loading");
    setShowCreate(false);
    fetchOperator(address).then((p) => {
      if (live) setProfile(p);
    });
    return () => {
      live = false;
    };
  }, [address]);

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[900px] px-6 pb-16 pt-12">
        <SectionLabel>operator</SectionLabel>
        <div className="mt-5 flex items-center gap-4">
          <span className="flex h-16 w-16 flex-none items-center justify-center rounded-full border border-pengu-blue/15 bg-white shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
            <AgentMascot color={operatorColor(address)} className="h-12 w-auto" />
          </span>
          <div className="min-w-0">
            <h1 className="break-all font-bubble text-[clamp(28px,4vw,48px)] uppercase leading-tight text-pengu-dark">
              {short(address)}
            </h1>
            {profile !== "loading" && profile?.xHandle && (
              <p className="mt-1 font-mono text-sm text-pengu-blue">@{profile.xHandle}</p>
            )}
          </div>
        </div>

        {isMe && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button onClick={() => setShowCreate(true)} className={primaryBtn}>
              create challenge
            </button>
            <HostCampaignButton className={secondaryBtn} />
            <a href="/contests" className={secondaryBtn}>
              enter a contest
            </a>
            <a href="/workshop" className={secondaryBtn}>
              workshop
            </a>
          </div>
        )}

        {profile === "loading" && <p className="mt-8 font-mono text-sm text-pengu-dark/50">loading profile…</p>}
        {profile === null && (
          <p className="mt-8 font-mono text-sm text-pengu-dark/50">no activity found for this address yet.</p>
        )}

        {profile && profile !== "loading" && (
          <>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="entered" value={String(profile.stats.entered)} />
              <Stat label="wins" value={String(profile.stats.wins)} />
              <Stat label="earned" value={formatUsdcString(profile.stats.earned)} />
              <Stat label="cycles" value={String(profile.cycles)} />
              <Stat label="reputation" value={String(formatReputation(profile.reputation))} />
            </div>

            <h2 className="mt-12 font-bubble text-2xl uppercase text-pengu-dark">agents</h2>
            <div className="mt-4 flex flex-col gap-2">
              {profile.agents.length === 0 && (
                <p className="font-mono text-sm text-pengu-dark/50">no agents claimed yet.</p>
              )}
              {profile.agents.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-card border border-pengu-blue/15 bg-white px-5 py-3.5 shadow-[0_8px_24px_rgba(70,45,150,0.06)]"
                >
                  <span className="font-mono text-sm text-pengu-dark">agent #{a.id}</span>
                  <span className="font-mono text-xs text-pengu-dark/55">{tiers(a)}</span>
                </div>
              ))}
            </div>

            <h2 className="mt-12 font-bubble text-2xl uppercase text-pengu-dark">recent contests</h2>
            <div className="mt-4 overflow-hidden rounded-card border border-pengu-blue/15 bg-white shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
              {profile.contests.length === 0 && (
                <p className="px-5 py-8 font-mono text-sm text-pengu-dark/50">no contests entered yet.</p>
              )}
              {profile.contests.map((ct) => (
                <a
                  key={ct.contestId}
                  href={`/contests/${ct.contestId}`}
                  className="grid grid-cols-[4rem_1fr_6rem_7rem] items-center gap-3 border-b border-pengu-blue/5 px-5 py-3.5 transition-colors last:border-0 hover:bg-pengu-blue/5"
                >
                  <span className="font-mono text-sm text-pengu-dark/70">#{ct.contestId}</span>
                  <span className="font-mono text-xs uppercase text-pengu-blue">
                    {ct.contestType == null ? "—" : (CONTEST_TYPE[ct.contestType] ?? ct.contestType)}
                  </span>
                  <span className="font-mono text-xs text-pengu-dark/55">{ct.status ?? "—"}</span>
                  <span className="text-right font-mono text-sm">
                    {ct.won ? (
                      <span className="text-pengu-blue">{formatUsdcString(ct.won)}</span>
                    ) : (
                      <span className="text-pengu-dark/35">—</span>
                    )}
                  </span>
                </a>
              ))}
            </div>
          </>
        )}
      </section>

      <Footer />

      <CreateChallengeModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
