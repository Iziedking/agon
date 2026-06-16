import { parseAbi } from "viem";

import { publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { coordinatorWallet } from "./contestOps.js";
import { settleContestToCompletion, resolveChallengeToCompletion } from "./autopilot.js";

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
}

/// Atomically claim the oldest pending command (single consumer, but
/// FOR UPDATE SKIP LOCKED keeps it safe if a second coordinator ever runs).
async function claimNext(): Promise<Command | null> {
  const { rows } = await query<{ id: string; kind: string; target_id: string }>(
    `update admin_commands set status = 'running', updated_at = now()
       where id = (
         select id from admin_commands where status = 'pending'
         order by id limit 1 for update skip locked
       )
     returning id, kind, target_id::text as target_id`,
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, kind: r.kind, targetId: r.target_id };
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
      return `${cmd.kind} ${id} sent: ${hash}`;
    }
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
