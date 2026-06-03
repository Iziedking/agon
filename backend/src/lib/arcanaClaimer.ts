import { pool, query } from "../db/pool.js";
import { config } from "../config/index.js";
import { arcanaMarketsAbi } from "../chain/abi.js";
import { getAgentWallet } from "./agentWallet.js";

/// Scans agent_positions for unclaimed winning positions on resolved
/// markets and fires claimWinnings(marketId) from each agent's hot wallet.
/// Picks up where it left off on every call (the `claimed` column is the
/// only state), so safe to invoke from a periodic worker without locking.
///
/// A position is a winner when:
/// - the market is resolved
/// - the agent's side matched the outcome
/// - the position hasn't been claimed yet
///
/// On success, sets claimed=true and claim_tx_hash. On failure, leaves the
/// row alone so the next sweep can retry. Per-position errors don't abort
/// the sweep; the worker is best-effort.

interface ClaimableRow {
  id: number;
  agent_id: number;
  operator: string;
  market_id: string;
  side: "yes" | "no";
  stake_usdc: string;
}

export interface ClaimResult {
  scanned: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

/// One pass of the claimer. Returns counts so the autopilot can log a
/// one-liner per cycle and so tests can assert behavior.
export async function claimSettledPositions(maxPerSweep = 50): Promise<ClaimResult> {
  const { rows } = await query<ClaimableRow>(
    `select ap.id, ap.agent_id, ap.operator, ap.market_id, ap.side, ap.stake_usdc
       from agent_positions ap
       join arcana_markets m on m.market_id = ap.market_id
      where ap.claimed = false
        and m.resolved = true
        and m.cancelled = false
        and (
          (m.outcome = true  and ap.side = 'yes') or
          (m.outcome = false and ap.side = 'no')
        )
      order by ap.id asc
      limit $1`,
    [maxPerSweep],
  );

  const result: ClaimResult = {
    scanned: rows.length,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    const wallet = getAgentWallet(row.agent_id);
    if (!wallet) {
      // No hot-wallet infra. Skip so a future sweep with the mnemonic set
      // can retry. Don't mark claimed.
      result.skipped++;
      continue;
    }
    result.attempted++;
    try {
      const hash = await wallet.writeContract({
        address: config.arcana.address,
        abi: arcanaMarketsAbi,
        functionName: "claimWinnings",
        args: [BigInt(row.market_id)],
      });
      await pool.query(
        "update agent_positions set claimed = true, claim_tx_hash = $1 where id = $2",
        [hash, row.id],
      );
      result.succeeded++;
      console.log(
        `arcana claim ok: agent=${row.agent_id} market=${row.market_id} side=${row.side} tx=${hash.slice(0, 12)}…`,
      );
    } catch (err) {
      result.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      // Two kinds of revert are normal: "already claimed" if the agent
      // claimed from another path, or "not a winner" if pools were empty
      // on the winning side and there's nothing to claim. Mark claimed in
      // both cases so we don't retry forever.
      const benign =
        msg.includes("already") ||
        msg.includes("not a winner") ||
        msg.includes("no shares") ||
        msg.includes("0x");
      if (benign) {
        await pool
          .query(
            "update agent_positions set claimed = true, claim_tx_hash = $1 where id = $2",
            ["benign-revert", row.id],
          )
          .catch(() => {});
      } else {
        console.error(`arcana claim failed: agent=${row.agent_id} market=${row.market_id} ${msg}`);
      }
    }
  }

  return result;
}

const DEFAULT_INTERVAL_MS = 30_000;

/// Long-running loop. Spawns from the autopilot bootstrap so the claimer
/// runs alongside contest cycles. Sleeps `intervalMs` between sweeps.
export async function startArcanaClaimerLoop(intervalMs = DEFAULT_INTERVAL_MS): Promise<void> {
  if (!config.arcana.indexing) {
    console.log("arcana claimer: disabled (ARCANA_INDEXING=0)");
    return;
  }
  console.log(`arcana claimer on: sweeping every ${Math.round(intervalMs / 1000)}s`);
  for (;;) {
    try {
      const result = await claimSettledPositions();
      if (result.scanned > 0) {
        console.log(
          `arcana claimer: scanned=${result.scanned} ok=${result.succeeded} failed=${result.failed} skipped=${result.skipped}`,
        );
      }
    } catch (err) {
      console.error("arcana claimer sweep failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
