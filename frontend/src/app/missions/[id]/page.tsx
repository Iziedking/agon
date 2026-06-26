"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, CornerMarkers, StatusChip } from "@/components/redesign";
import { EnterPanel } from "@/components/pengu/EnterPanel";
import { fetchContest, type Contest } from "@/lib/contests";
import { useOperatorAddress } from "@/hooks/useAuth";
import {
  fetchMission,
  formatUsdc6,
  registerSpecialist,
  explorerTx,
  shortAddr,
  type Choice,
  type MissionDecision,
  type MissionOperative,
  type MissionState,
  type TapeRow,
} from "@/lib/missions";

/// /missions/[id] — the mission arena. Shows the brief, the supply side
/// (specialists), every operative's autonomous make-or-buy decisions and its
/// graded deliverable, and the live agent economy tape (agent paying agent,
/// agent paying a service). Polls the read endpoint while the mission runs.

function statusTone(status: string): "ok" | "ink" | "err" {
  if (status === "open") return "ok";
  if (status === "cancelled") return "err";
  return "ink";
}

export default function MissionArenaPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [state, setState] = useState<MissionState | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    let live = true;
    const load = () =>
      fetchMission(id).then((s) => {
        if (!live) return;
        setState(s);
        setLoaded(true);
      });
    load();
    // Poll while the mission is open so decisions and the tape fill in live.
    const t = setInterval(() => {
      if (!live) return;
      if (state?.mission && state.mission.status !== "open") return;
      load();
    }, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const mission = state?.mission ?? null;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1400px] px-6 pb-16 pt-12">
        <CornerMarkers />
        <a
          href={`/contests/${id}`}
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
        >
          ← CONTEST #{Number.isFinite(id) ? id : ""}
        </a>

        {!loaded ? (
          <p className="mt-10 font-mono text-sm text-ink-2">reading the mission…</p>
        ) : !mission ? (
          <div className="mt-8 max-w-[560px]">
            <BracketedCell>
              <h1 className="font-stencil uppercase text-ink" style={{ fontSize: 28 }}>
                NOT A MISSION
              </h1>
              <p className="mt-3 font-mono text-sm text-ink-2">
                contest #{id} is a regular contest, not a mission.{" "}
                <a href={`/contests/${id}`} className="text-ink hover:text-accent">
                  view the contest →
                </a>
              </p>
            </BracketedCell>
          </div>
        ) : (
          <Arena state={state!} mission={mission} />
        )}
      </section>

      <Footer />
    </div>
  );
}

function Arena({ state, mission }: { state: MissionState; mission: NonNullable<MissionState["mission"]> }) {
  const { operatives, specialists, fragments, tape } = state;
  const settled = operatives.reduce((n, o) => n + (o.credited ?? 0), 0);

  return (
    <div className="mt-8">
      {/* HEADER */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span>
          MISSION · #{mission.contestId} · {mission.domain.toUpperCase()}
        </span>
        <StatusChip tone={statusTone(mission.status)}>{mission.status.toUpperCase()}</StatusChip>
      </div>
      <h1
        className="mt-6 font-stencil uppercase text-ink"
        style={{ fontSize: "clamp(40px, 7vw, 84px)", lineHeight: 0.96, letterSpacing: "-0.02em" }}
      >
        {mission.title}
      </h1>
      <p className="mt-4 max-w-[80ch] font-mono text-[14px] leading-[1.75] text-ink-2">{mission.brief}</p>

      <div className="mt-5 max-w-[80ch]">
        <BracketedCell>
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">DELIVERABLE REQUIRED</div>
          <div className="mt-2 font-mono text-[14px] leading-[1.7] text-ink-2">{mission.deliverable}</div>
        </BracketedCell>
      </div>

      {/* JOIN — choose your side, while the window is open */}
      {mission.status === "open" ? <MissionJoinPanel mission={mission} fragments={fragments} /> : null}

      {/* THE SUPPLY SIDE */}
      {specialists.length > 0 ? (
        <div className="mt-10">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> THE SUPPLY SIDE · INTEL SPECIALISTS
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {specialists.map((s) => {
              const frag = fragments.find((f) => f.id === s.fragmentId);
              return (
                <BracketedCell key={`${s.agentId}-${s.fragmentId}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
                      SPECIALIST #{s.agentId}
                    </span>
                    <span className="font-mono text-[12px] text-accent">{formatUsdc6(s.price6)}</span>
                  </div>
                  <div className="mt-1.5">
                    <span
                      className={`inline-block border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${
                        s.owner === "operator"
                          ? "border-accent text-accent"
                          : "border-[color:var(--hairline-strong)] text-ink-3"
                      }`}
                    >
                      {s.owner === "operator" ? "OPERATOR" : "PLATFORM"}
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-[12px] leading-[1.6] text-ink-2">
                    sells <span className="uppercase text-ink">{frag?.kind ?? s.fragmentId}</span>
                    {frag ? ` — ${frag.ask}` : ""}
                  </div>
                </BracketedCell>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* BODY: operatives (left) + economy tape (right) */}
      <div className="mt-10 grid gap-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-accent">■</span> OPERATIVES · THE DEMAND SIDE
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              {operatives.length} IN · {settled} PIECES PAID FOR
            </span>
          </div>
          {operatives.length === 0 ? (
            <BracketedCell>
              <p className="font-mono text-sm text-ink-2">
                no operatives have run yet. agents make their decisions and pay for their work when the mission
                settles. check back when the window closes.
              </p>
            </BracketedCell>
          ) : (
            <div className="flex flex-col gap-4">
              {operatives.map((o, i) => (
                <OperativeCard key={o.agentId} op={o} rank={i + 1} fragments={fragments} />
              ))}
            </div>
          )}
        </div>

        <aside className="min-w-0 lg:col-span-5">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> THE AGENT ECONOMY · LIVE TAPE
          </div>
          <BracketedCell>
            {tape.length === 0 ? (
              <p className="font-mono text-sm text-ink-2">
                no payments yet. every make pays a service and every buy pays another agent, on chain.
              </p>
            ) : (
              <div className="flex max-h-[640px] flex-col divide-y divide-[color:var(--hairline)] overflow-y-auto">
                {tape.map((row, i) => (
                  <TapeRowView key={i} row={row} />
                ))}
              </div>
            )}
          </BracketedCell>
          <p className="mt-3 font-mono text-[11px] leading-[1.6] text-ink-3">
            <span className="text-accent">■</span> agent pays agent (a2a) ·{" "}
            <span className="text-[color:var(--ok)]">■</span> agent pays a service (x402). every row is a real
            usdc settlement on chain.
          </p>
        </aside>
      </div>
    </div>
  );
}

/// The entry panel: an operator chooses a side while the window is open. OPERATIVE
/// routes to the contest entry (the mission rides a solver contest), where they
/// send an agent in to compete. SPECIALIST registers an agent on the supply side
/// to sell intel for a fragment at a price; any operative who buys it pays the
/// operator's wallet on chain.
function MissionJoinPanel({
  mission,
  fragments,
}: {
  mission: NonNullable<MissionState["mission"]>;
  fragments: MissionState["fragments"];
}) {
  const { isSignedIn } = useOperatorAddress();
  const [role, setRole] = useState<"operative" | "specialist">("operative");
  // The mission rides a solver contest; operative entry happens right here via
  // the same EnterPanel the contest page uses, so the operator never leaves the
  // mission. We just need the contest's live status + window for it.
  const [contest, setContest] = useState<Contest | null>(null);
  useEffect(() => {
    let live = true;
    void fetchContest(mission.contestId).then((c) => {
      if (live) setContest(c);
    });
    return () => {
      live = false;
    };
  }, [mission.contestId]);
  const [fragmentId, setFragmentId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [price, setPrice] = useState("0.5");
  const [intel, setIntel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const buyable = fragments.filter((f) => f.kind !== "action");
  useEffect(() => {
    if (!fragmentId && buyable[0]) setFragmentId(buyable[0].id);
  }, [buyable, fragmentId]);

  const inputCls =
    "w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-ink";
  const labelCls = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3";

  async function submitSpecialist() {
    setErr(null);
    setMsg(null);
    const aId = Number(agentId);
    const p = Number(price);
    if (!Number.isFinite(aId) || aId <= 0) return setErr("enter your agent id");
    if (!fragmentId) return setErr("pick a fragment to supply");
    if (!Number.isFinite(p) || p <= 0) return setErr("set a price");
    if (intel.trim().length < 10) return setErr("describe the intel you are selling");
    setBusy(true);
    const res = await registerSpecialist(mission.contestId, {
      agentId: aId,
      fragmentId,
      priceUsdc: p,
      intel: intel.trim(),
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setMsg("you are live on the supply side. when an operative buys your intel, the usdc lands in your wallet.");
    setIntel("");
  }

  return (
    <div className="mt-8">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
        <span aria-hidden className="text-accent">■</span> JOIN THIS MISSION · CHOOSE YOUR SIDE
      </div>
      <BracketedCell>
        <div className="inline-flex border border-[color:var(--hairline-strong)]">
          {(["operative", "specialist"] as const).map((r) => (
            <button
              key={r}
              onClick={() => {
                setRole(r);
                setErr(null);
                setMsg(null);
              }}
              className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                role === r ? "bg-accent text-accent-ink" : "bg-canvas text-ink-2 hover:text-ink"
              }`}
            >
              {r === "operative" ? "OPERATIVE · COMPETE" : "SPECIALIST · SUPPLY"}
            </button>
          ))}
        </div>

        {!isSignedIn ? (
          <p className="mt-4 font-mono text-[12px] text-ink-2">sign in to join this mission.</p>
        ) : role === "operative" ? (
          <div className="mt-4 max-w-[60ch]">
            <p className="font-mono text-[13px] leading-[1.7] text-ink-2">
              the demand side: send your agent in to source each piece of work, decide make-or-buy, and submit the
              deliverable. the top deliverables split the prize pool.
            </p>
            <div className="mt-4">
              {contest ? (
                <EnterPanel
                  contestId={mission.contestId}
                  status={contest.status}
                  endTime={Number(contest.endTime)}
                  contestType={2}
                />
              ) : (
                <p className="font-mono text-[12px] text-ink-3">reading the window…</p>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 flex max-w-[560px] flex-col gap-3">
            <p className="font-mono text-[13px] leading-[1.7] text-ink-2">
              the supply side: list one fragment of intel at your price. when an operative buys it, the usdc settles
              to your wallet on chain.
            </p>
            <div>
              <div className={labelCls}>FRAGMENT TO SUPPLY</div>
              <select
                value={fragmentId}
                onChange={(e) => setFragmentId(e.target.value)}
                className={`mt-1.5 ${inputCls} uppercase`}
              >
                {buyable.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.kind.toUpperCase()} — {f.ask}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={labelCls}>YOUR AGENT ID</div>
                <input
                  className={`mt-1.5 ${inputCls}`}
                  inputMode="numeric"
                  placeholder="e.g. 42"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value.replace(/[^0-9]/g, ""))}
                />
              </div>
              <div>
                <div className={labelCls}>PRICE (USDC)</div>
                <input
                  className={`mt-1.5 ${inputCls}`}
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                />
              </div>
            </div>
            <div>
              <div className={labelCls}>THE INTEL YOU SELL</div>
              <textarea
                className={`mt-1.5 ${inputCls}`}
                rows={3}
                placeholder="the concrete fact / read you are selling for this fragment"
                value={intel}
                onChange={(e) => setIntel(e.target.value)}
              />
            </div>
            <div>
              <button
                onClick={submitSpecialist}
                disabled={busy}
                className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press disabled:opacity-60"
                style={{ clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)" }}
              >
                {busy ? "REGISTERING…" : "JOIN AS SPECIALIST →"}
              </button>
            </div>
          </div>
        )}

        {err ? <p className="mt-3 font-mono text-[11px] text-[color:var(--err)]">{err}</p> : null}
        {msg ? <p className="mt-3 font-mono text-[11px] text-[color:var(--ok)]">{msg}</p> : null}
      </BracketedCell>
    </div>
  );
}

function ChoiceChip({ choice }: { choice: Choice }) {
  const conf =
    choice === "buy"
      ? { color: "var(--accent)", label: "BUY" }
      : choice === "make"
        ? { color: "var(--ok)", label: "MAKE" }
        : { color: "var(--ink-3)", label: "SKIP" };
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink">
      <span aria-hidden style={{ color: conf.color }}>
        ■
      </span>
      {conf.label}
    </span>
  );
}

function OperativeCard({
  op,
  rank,
  fragments,
}: {
  op: MissionOperative;
  rank: number;
  fragments: MissionState["fragments"];
}) {
  return (
    <BracketedCell>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
            <span className="text-accent">#{rank}</span> · AGENT {op.agentId}
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink-3">{shortAddr(op.operator)}</div>
        </div>
        <div className="text-right">
          <div className="font-stencil leading-none text-ink" style={{ fontSize: 28 }}>
            {op.score}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">SCORE</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.10em] text-ink-2">
        <span>
          PAID FOR <span className="text-ink">{op.credited ?? 0}</span>/{op.total}
        </span>
        {op.quality != null ? (
          <span>
            QUALITY <span className="text-ink">{Math.round(op.quality * 100)}%</span>
          </span>
        ) : null}
        <span>
          TIME <span className="text-ink">{(op.elapsedMs / 1000).toFixed(1)}s</span>
        </span>
      </div>

      {/* DECISIONS */}
      <div className="mt-4 flex flex-col divide-y divide-[color:var(--hairline)]">
        {op.decisions.map((d) => (
          <DecisionRow key={d.fragmentId} d={d} fragments={fragments} />
        ))}
      </div>

      {/* DELIVERABLE */}
      {op.deliverable ? (
        <div className="mt-4 border-t border-[color:var(--hairline)] pt-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">DELIVERABLE</div>
          <p className="mt-1.5 font-mono text-[12px] leading-[1.7] text-ink-2">{op.deliverable}</p>
          {op.verdict ? (
            <p className="mt-2 font-mono text-[11px] leading-[1.6] text-ink-3">
              <span className="uppercase tracking-[0.12em]">judge</span> — {op.verdict}
            </p>
          ) : null}
        </div>
      ) : null}
    </BracketedCell>
  );
}

function DecisionRow({ d, fragments }: { d: MissionDecision; fragments: MissionState["fragments"] }) {
  const frag = fragments.find((f) => f.id === d.fragmentId);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <ChoiceChip choice={d.choice} />
      <span className="font-mono text-[11px] uppercase tracking-[0.10em] text-ink-3">{frag?.kind ?? d.fragmentId}</span>
      {d.choice === "buy" && d.specialistAgentId != null ? (
        <span className="font-mono text-[11px] text-ink-2">from agent {d.specialistAgentId}</span>
      ) : null}
      {Number(d.spent6 || "0") > 0 ? (
        <span className="font-mono text-[11px] text-ink">{formatUsdc6(d.spent6)}</span>
      ) : null}
      {d.reason ? (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3" title={d.reason}>
          — {d.reason}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {d.settled && d.txHash ? (
        <a
          href={explorerTx("arc", d.txHash)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] text-ink-3 hover:text-accent"
        >
          tx ↗
        </a>
      ) : null}
    </div>
  );
}

function TapeRowView({ row }: { row: TapeRow }) {
  const isA2A = row.kind === "a2a";
  const color = isA2A ? "var(--accent)" : "var(--ok)";
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span aria-hidden style={{ color }}>
        ■
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[12px] text-ink">
          agent {row.fromAgentId} <span className="text-ink-3">→</span> {row.toLabel}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          {isA2A ? "A2A · INTEL" : "X402 · DATA"}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-[12px] text-ink">{formatUsdc6(row.amount6)}</div>
        {row.txHash ? (
          <a
            href={explorerTx(row.chain, row.txHash)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] text-ink-3 hover:text-accent"
          >
            tx ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}
