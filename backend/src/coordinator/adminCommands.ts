import { parseAbi } from "viem";

import { publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { coordinatorWallet, openMission } from "./contestOps.js";
import { settleContestToCompletion, resolveChallengeToCompletion } from "./autopilot.js";
import { setTierGate } from "../lib/tierGate.js";
import { broadcastTelegram } from "../notifications/index.js";
import {
  refundMissionFees,
  refundMissionBuys,
  markMissionStatus,
  refundAllCancelledMissions,
  clearMissionHistory,
} from "../runners/missions/fees.js";

/// Admin command worker. The admin console (auth API process) inserts rows into
/// admin_commands; this loop runs in the COORDINATOR process and drains them, so
/// a manual settle/resolve/cancel executes in the same place as the autopilot
/// sweeper — one coordinator nonce owner, real WS broadcast, the shared
/// single-flight guard — instead of being fired from the API process where it
/// would race the sweeper and broadcast nowhere.

const cancelAbi = parseAbi([
  "function cancelContest(uint256 contestId)",
  "function cancelChallenge(uint256 id)",
]);

const RECEIPT_TIMEOUT_MS = Number(process.env.SETTLE_RECEIPT_TIMEOUT_SECONDS ?? "90") * 1000;

interface Command {
  id: string;
  kind: string;
  targetId: string;
  params: Record<string, unknown> | null;
}

/// Atomically claim the oldest pending command (single consumer, but
/// FOR UPDATE SKIP LOCKED keeps it safe if a second coordinator ever runs).
async function claimNext(): Promise<Command | null> {
  const { rows } = await query<{ id: string; kind: string; target_id: string; params: Record<string, unknown> | null }>(
    `update admin_commands set status = 'running', updated_at = now()
       where id = (
         select id from admin_commands where status = 'pending'
         order by id limit 1 for update skip locked
       )
     returning id, kind, target_id::text as target_id, params`,
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, kind: r.kind, targetId: r.target_id, params: r.params ?? null };
}

async function finish(id: string, status: "done" | "error", result: string): Promise<void> {
  await query("update admin_commands set status = $2, result = $3, updated_at = now() where id = $1", [
    id,
    status,
    result.slice(0, 500),
  ]);
}

async function cancelOnChain(kind: "cancel_contest" | "cancel_challenge", targetId: bigint): Promise<string> {
  const wallet = coordinatorWallet();
  const address = kind === "cancel_contest" ? config.contracts.ContestEngine : config.contracts.ChallengeArena;
  const functionName = kind === "cancel_contest" ? "cancelContest" : "cancelChallenge";
  const hash = await wallet.writeContract({
    address,
    abi: cancelAbi,
    functionName,
    args: [targetId],
  } as never);
  await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  return hash;
}

/// Open a mission on demand from the admin console. Uses the SAME openMission
/// path the autopilot uses (real on-chain solver contest + generateMission +
/// seedSpecialists), so an admin-opened mission is real agent work, not a stub.
/// Params are all optional: domain (solver|analyst, default solver), poolUsdc
/// (default MISSION_POOL_USDC_MIN or 200), windowSeconds (default 600). Seat
/// counts and the internal/external mix come from the mission env, unchanged.
async function openMissionNow(
  params: Record<string, unknown> | null,
  broadcast: (message: unknown) => void,
): Promise<string> {
  const p = params ?? {};
  const domainRaw = String(p.domain ?? "solver").toLowerCase();
  const domain: "solver" | "analyst" = domainRaw === "analyst" ? "analyst" : "solver";
  const poolFromEnv = Number(process.env.MISSION_POOL_USDC_MIN ?? "0");
  const poolUsdc = Number(p.poolUsdc) > 0 ? Number(p.poolUsdc) : poolFromEnv > 0 ? poolFromEnv : 200;
  const windowSeconds = Number(p.windowSeconds) > 0 ? Math.floor(Number(p.windowSeconds)) : 600;
  // Optional explicit template (e.g. "sector-risk-audit"); blank = rotate.
  const templateId = typeof p.templateId === "string" && p.templateId.trim() ? p.templateId.trim() : undefined;
  // Optional per-mission seat caps; undefined falls back to the global config.
  const operativeSeats = Number(p.operativeSeats) > 0 ? Math.floor(Number(p.operativeSeats)) : undefined;
  const specialistSeats = Number(p.specialistSeats) > 0 ? Math.floor(Number(p.specialistSeats)) : undefined;
  // Optional per-mission economics; undefined falls back to the global config.
  const operativeFeeBps = Number(p.feePct) >= 0 && p.feePct !== undefined && p.feePct !== null
    ? Math.round(Number(p.feePct) * 100)
    : undefined;
  const basePriceUsdc = Number(p.basePriceUsdc) > 0 ? Number(p.basePriceUsdc) : undefined;

  const contestId = await openMission({
    poolUsdc,
    durationSeconds: windowSeconds,
    domain,
    templateId,
    operativeSeats,
    specialistSeats,
    operativeFeeBps,
    basePriceUsdc,
    minTier: config.mission.minTier,
  });
  await setTierGate("contest", contestId, config.mission.minTier, 4).catch(() => {});
  broadcast({
    type: "contest_open",
    contestId,
    contestType: "mission",
    endsAt: Date.now() + windowSeconds * 1000,
  });
  void broadcastTelegram({
    title: `New mission live · ${poolUsdc} USDC pool`,
    body: `${domain.toUpperCase()} mission #${contestId} is open for ${Math.round(windowSeconds / 60)} min. Enter as an operative or grab a specialist seat.`,
    href: `/missions/${contestId}`,
  }).catch(() => {});
  const seatNote = operativeSeats || specialistSeats
    ? `, seats ${operativeSeats ?? config.mission.operativeSeats} op / ${specialistSeats ?? config.mission.specialistSeats} spec`
    : "";
  return `mission ${contestId} opened (${domain}, ${poolUsdc} USDC, ${windowSeconds}s window${seatNote})`;
}

async function execute(cmd: Command, broadcast: (message: unknown) => void): Promise<string> {
  const id = Number(cmd.targetId);
  if (!Number.isFinite(id)) throw new Error(`bad target id ${cmd.targetId}`);
  switch (cmd.kind) {
    case "settle_contest":
      await settleContestToCompletion(id, broadcast);
      return `contest ${id} settle run complete`;
    case "resolve_challenge":
      await resolveChallengeToCompletion(id, broadcast);
      return `challenge ${id} resolve run complete`;
    case "cancel_contest":
    case "cancel_challenge": {
      const hash = await cancelOnChain(cmd.kind, BigInt(id));
      if (cmd.kind === "cancel_contest") {
        // If this contest is a mission, return the operatives' join fees and the
        // specialists' intel purchases, then stamp it cancelled. No-op otherwise.
        await refundMissionFees(id).catch((e) =>
          console.error(`admin cancel ${id}: fee refund failed:`, e instanceof Error ? e.message : e),
        );
        await refundMissionBuys(id).catch((e) =>
          console.error(`admin cancel ${id}: buy refund failed:`, e instanceof Error ? e.message : e),
        );
        await markMissionStatus(id, "cancelled");
      }
      return `${cmd.kind} ${id} sent: ${hash}`;
    }
    case "refund_missions":
      // id > 0 targets one mission; 0 refunds every cancelled mission.
      return await refundAllCancelledMissions(id > 0 ? id : undefined);
    case "clear_missions":
      return await clearMissionHistory();
    case "open_mission":
      return await openMissionNow(cmd.params, broadcast);
    default:
      throw new Error(`unknown command kind ${cmd.kind}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startAdminCommandWorker(broadcast: (message: unknown) => void): Promise<void> {
  const everyMs = Number(process.env.ADMIN_COMMAND_POLL_SECONDS ?? "4") * 1000;
  console.log("admin command worker: draining admin_commands queue");
  for (;;) {
    await sleep(everyMs);
    try {
      // Drain all currently-pending commands this tick (one at a time).
      for (;;) {
        const cmd = await claimNext();
        if (!cmd) break;
        console.log(`admin command ${cmd.id}: ${cmd.kind} target ${cmd.targetId}`);
        try {
          const result = await execute(cmd, broadcast);
          await finish(cmd.id, "done", result);
          console.log(`admin command ${cmd.id}: done — ${result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await finish(cmd.id, "error", msg);
          console.error(`admin command ${cmd.id}: error — ${msg}`);
        }
      }
    } catch (err) {
      console.error("admin command worker failed:", err instanceof Error ? err.message : err);
    }
  }
}
