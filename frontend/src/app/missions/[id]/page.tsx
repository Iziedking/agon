"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { erc20Abi } from "viem";
import { AgentAvatar, BracketedCell, CornerMarkers, StatusChip, robotVariantForId } from "@/components/redesign";
import { nameFor, skinFor, useAgentNames, useAgentSkins } from "@/hooks/useAgentNames";
import { EnterPanel } from "@/components/pengu/EnterPanel";
import { fetchContest, type Contest } from "@/lib/contests";
import { USDC, confirmTx } from "@/lib/arc";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import {
  fetchMission,
  formatUsdc6,
  buyMissionIntel,
  explorerTx,
  shortAddr,
  type Choice,
  type MissionDecision,
  type MissionJoin,
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
  // Resolve each operative's agent name + pfp (skin), the same way the live
  // stages and leaderboard do, so a card reads as the operator, not "AGENT N".
  const names = useAgentNames(operatives.map((o) => o.agentId));
  const skins = useAgentSkins(operatives.map((o) => o.agentId));
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
        {mission.archetype ? (
          <span
            className={`inline-block border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
              mission.archetype === "external" ? "border-[color:var(--ok)] text-[color:var(--ok)]" : "border-accent text-accent"
            }`}
          >
            {mission.archetype === "external" ? "X402 · PAY PER CALL" : "INTEL MARKET"}
          </span>
        ) : null}
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

      {/* THE ECONOMY AT A GLANCE */}
      {state.join ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <EconStat label="PRIZE POOL" value={formatUsdc6(state.join.poolUsdc6)} />
          <EconStat
            label="OPERATIVE FEE"
            value={Number(state.join.operativeFee6) > 0 ? formatUsdc6(state.join.operativeFee6) : "FREE"}
          />
          <EconStat
            label="SPECIALIST SEATS"
            value={`${state.join.specialistSeats.taken}/${state.join.specialistSeats.total}`}
          />
          <EconStat
            label="OPERATIVE SEATS"
            value={`${state.join.operativeSeats.taken}/${state.join.operativeSeats.total}`}
          />
        </div>
      ) : null}

      {/* JOIN — choose your side, while the window is open */}
      {mission.status === "open" ? (
        <MissionJoinPanel mission={mission} fragments={fragments} specialists={specialists} join={state.join} />
      ) : null}

      {/* THE SUPPLY SIDE */}
      {specialists.length > 0 ? (
        <div className="mt-10">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> THE SUPPLY SIDE · INTEL SPECIALISTS
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {specialists
              .filter((s) => !(s.owner === "platform" && s.claimed))
              .map((s) => {
              const frag = fragments.find((f) => f.id === s.fragmentId);
              return (
                <BracketedCell key={`${s.agentId}-${s.fragmentId}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
                      {s.owner === "operator" ? `SPECIALIST #${s.agentId}` : "ON THE SHELF"}
                    </span>
                    <span className="font-mono text-[12px] text-accent">{formatUsdc6(s.price6)}</span>
                  </div>
                  <div className="mt-1.5">
                    <span
                      className={`inline-block border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${
                        s.owner === "operator"
                          ? "border-accent text-accent"
                          : "border-[color:var(--ok)] text-[color:var(--ok)]"
                      }`}
                    >
                      {s.owner === "operator" ? "RESALE" : "BUY FROM PLATFORM"}
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-[12px] leading-[1.6] text-ink-2">
                    {s.owner === "operator" ? "resells" : "sells"}{" "}
                    <span className="uppercase text-ink">{frag?.kind ?? s.fragmentId}</span>
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
                <OperativeCard
                  key={o.agentId}
                  op={o}
                  rank={i + 1}
                  fragments={fragments}
                  name={nameFor(names, o.agentId)}
                  skin={skinFor(skins, o.agentId)}
                />
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
  specialists,
  join,
}: {
  mission: NonNullable<MissionState["mission"]>;
  fragments: MissionState["fragments"];
  specialists: MissionState["specialists"];
  join?: MissionJoin;
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
  const { writeContractAsync } = useArcWrite();
  const [fragmentId, setFragmentId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [price, setPrice] = useState("10");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // The scarce shelf: platform pieces still unclaimed. A specialist buys one of
  // these at its base price `b`, then resells it.
  const availablePieces = specialists.filter((s) => s.owner === "platform" && !s.claimed);
  useEffect(() => {
    if (!fragmentId && availablePieces[0]) setFragmentId(availablePieces[0].fragmentId);
  }, [availablePieces, fragmentId]);
  const selectedPiece = availablePieces.find((p) => p.fragmentId === fragmentId);

  const inputCls =
    "w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-ink";
  const labelCls = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3";

  async function buyPiece() {
    setErr(null);
    setMsg(null);
    const aId = Number(agentId);
    const r = Number(price);
    if (!selectedPiece) return setErr("pick an available piece");
    if (!Number.isFinite(aId) || aId <= 0) return setErr("enter your agent id");
    if (!Number.isFinite(r) || r <= 0) return setErr("set a resale price");
    if (!join?.feeRecipient) return setErr("the platform treasury is not configured; cannot buy");
    setBusy(true);
    try {
      // Pay the base price `b` to the platform treasury, then claim the piece.
      const txHash = await writeContractAsync({
        address: USDC,
        abi: erc20Abi,
        functionName: "transfer",
        args: [join.feeRecipient as `0x${string}`, BigInt(selectedPiece.price6)],
      });
      await confirmTx(txHash);
      const res = await buyMissionIntel(mission.contestId, {
        fragmentId,
        agentId: aId,
        resalePriceUsdc: r,
        txHash,
      });
      if (!res.ok) {
        setErr(res.error);
        setBusy(false);
        return;
      }
      setMsg("you own this piece. it is listed for resale; an operative buys it from you on chain.");
      setBusy(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message.toLowerCase() : "could not buy the piece.");
      setBusy(false);
    }
  }

  const opFull = join ? join.operativeSeats.taken >= join.operativeSeats.total : false;
  const specFull = join ? join.specialistSeats.taken >= join.specialistSeats.total : false;
  // Pass the operative fee to the entry panel only when there is a treasury and a
  // non-zero fee; otherwise entry is free.
  const missionFee =
    join && join.feeRecipient && Number(join.operativeFee6) > 0
      ? { fee6: join.operativeFee6, recipient: join.feeRecipient, missionId: mission.contestId }
      : undefined;

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
            {join ? (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                {Number(join.operativeFee6) > 0 ? (
                  <span>
                    JOIN FEE <span className="text-ink">{formatUsdc6(join.operativeFee6)}</span>
                  </span>
                ) : null}
                <span>
                  SEATS{" "}
                  <span className={opFull ? "text-[color:var(--err)]" : "text-ink"}>
                    {join.operativeSeats.taken}/{join.operativeSeats.total}
                  </span>
                </span>
              </div>
            ) : null}
            <div className="mt-4">
              {opFull ? (
                <p className="font-mono text-[12px] text-[color:var(--err)]">
                  operative seats are full for this mission.
                </p>
              ) : contest ? (
                <EnterPanel
                  contestId={mission.contestId}
                  status={contest.status}
                  endTime={Number(contest.endTime)}
                  contestType={2}
                  missionFee={missionFee}
                />
              ) : (
                <p className="font-mono text-[12px] text-ink-3">reading the window…</p>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 flex max-w-[560px] flex-col gap-3">
            <p className="font-mono text-[13px] leading-[1.7] text-ink-2">
              the supply side: buy a scarce intel piece from the platform at its base price, then list it at your own
              resale price. an operative who needs it buys it from you on chain.
            </p>
            {join ? (
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                SPECIALIST SEATS{" "}
                <span className={specFull ? "text-[color:var(--err)]" : "text-ink"}>
                  {join.specialistSeats.taken}/{join.specialistSeats.total}
                </span>
                {" · NO JOIN FEE · MAX 2 PIECES"}
              </div>
            ) : null}
            {availablePieces.length === 0 ? (
              <p className="font-mono text-[12px] text-ink-3">every piece on the shelf has been claimed.</p>
            ) : (
              <>
                <div>
                  <div className={labelCls}>PIECE TO BUY</div>
                  <select
                    value={fragmentId}
                    onChange={(e) => setFragmentId(e.target.value)}
                    className={`mt-1.5 ${inputCls} uppercase`}
                  >
                    {availablePieces.map((s) => {
                      const f = fragments.find((x) => x.id === s.fragmentId);
                      return (
                        <option key={s.fragmentId} value={s.fragmentId}>
                          {(f?.kind ?? s.fragmentId).toUpperCase()} — {f?.ask ?? ""} · BUY {formatUsdc6(s.price6)}
                        </option>
                      );
                    })}
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
                    <div className={labelCls}>YOUR RESALE PRICE (USDC)</div>
                    <input
                      className={`mt-1.5 ${inputCls}`}
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                    />
                  </div>
                </div>
                <div>
                  <button
                    onClick={buyPiece}
                    disabled={busy || specFull || !selectedPiece}
                    className="inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press disabled:opacity-60"
                    style={{ clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)" }}
                  >
                    {busy
                      ? "BUYING…"
                      : selectedPiece
                        ? `BUY FOR ${formatUsdc6(selectedPiece.price6)} →`
                        : "BUY →"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {err ? <p className="mt-3 font-mono text-[11px] text-[color:var(--err)]">{err}</p> : null}
        {msg ? <p className="mt-3 font-mono text-[11px] text-[color:var(--ok)]">{msg}</p> : null}
      </BracketedCell>
    </div>
  );
}

function EconStat({ label, value }: { label: string; value: string }) {
  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{label}</div>
      <div className="mt-1.5 font-mono text-[15px] tabular-nums text-ink">{value}</div>
    </BracketedCell>
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
  name,
  skin,
}: {
  op: MissionOperative;
  rank: number;
  fragments: MissionState["fragments"];
  name?: string | null;
  skin?: string | null;
}) {
  return (
    <BracketedCell>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentAvatar skin={skin ?? undefined} variant={robotVariantForId(op.agentId)} size={32} />
          <div className="min-w-0">
            <div className="truncate font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
              <span className="text-accent">#{rank}</span> · {name || `AGENT ${op.agentId}`}
            </div>
            <div className="mt-1 font-mono text-[11px] text-ink-3">{shortAddr(op.operator)}</div>
          </div>
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
  const color = row.kind === "a2a" ? "var(--accent)" : row.kind === "shelf" ? "var(--warn)" : "var(--ok)";
  const label = row.kind === "a2a" ? "A2A · RESALE" : row.kind === "shelf" ? "SHELF · BOUGHT INTEL" : "X402 · DATA";
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span aria-hidden style={{ color }}>
        ■
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[12px] text-ink">
          agent {row.fromAgentId} <span className="text-ink-3">→</span> {row.toLabel}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{label}</div>
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
