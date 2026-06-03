import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { pool, query } from "../db/pool.js";
import { usdcMinimalAbi } from "../chain/abi.js";

/// Drips USDC from the coordinator wallet to an agent's hot wallet so it can
/// trade on Arcana. Guard rails:
/// - hard kill switch via config.analystAutofund.enabled
/// - one drip per agent per UTC day (DB unique index)
/// - global daily cap across all agents (summed from log table)
/// - no-op when the agent already has more than minBalanceUsdc
/// - silently skips when the coordinator wallet has insufficient USDC
///
/// Returns the tx hash on success, null when skipped for any benign reason
/// (already funded, cap hit, kill switch off). Throws only on genuinely
/// unexpected failures so the caller can log and continue.

const USDC_6 = 1_000_000n;

function todayUtc(): string {
  // YYYY-MM-DD in UTC for the drip_day column.
  return new Date().toISOString().slice(0, 10);
}

function coordinatorWallet() {
  const pk = config.coordinator.privateKey;
  if (!pk) return null;
  const account = privateKeyToAccount(pk);
  return createWalletClient({ account, chain: arcTestnet, transport: http(config.rpcHttp) });
}

async function coordinatorUsdcBalance(coordinatorAddress: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: config.external.USDC,
    abi: usdcMinimalAbi,
    functionName: "balanceOf",
    args: [coordinatorAddress],
  }) as Promise<bigint>;
}

async function dailySpentUsd(day: string): Promise<number> {
  const { rows } = await query<{ total: string | null }>(
    "select coalesce(sum(amount_usd), 0)::text as total from analyst_autofund_log where drip_day = $1",
    [day],
  );
  return Number(rows[0]?.total ?? 0);
}

export interface AutofundResult {
  txHash: string | null;
  /// One of: "ok" (drip sent), "already_funded" (balance ok), "already_dripped"
  /// (agent got their drip today), "cap_hit" (global daily cap reached),
  /// "disabled" (kill switch off), "no_coordinator" (no key), "coord_broke"
  /// (coordinator has no USDC), "error" (unexpected).
  reason: string;
}

/// Pick the per-tier drip amount. Tier 0 is ineligible for Analyst Arcana
/// contests (caller already filters), so a drip request at tier 0 returns
/// the tier-1 amount as a safety floor. Tiers above 4 clamp to tier 4.
function dripUsdForTier(tier: number): number {
  const drips = config.analystAutofund.dripUsdcByTier;
  const idx = Math.max(1, Math.min(4, tier)) - 1;
  return drips[idx] ?? 0;
}

/// Top up an agent's hot wallet if eligible. The caller decides who the
/// hot-wallet address is so this module doesn't need to know about Scout's
/// derivation. Idempotent: safe to call twice in the same round; the second
/// call returns "already_dripped".
export async function maybeAutofundAgent(args: {
  agentId: number;
  tier: number;
  operator: `0x${string}`;
  hotWalletAddress: `0x${string}`;
  currentBalanceUsdc6: bigint;
}): Promise<AutofundResult> {
  const { agentId, tier, operator, hotWalletAddress, currentBalanceUsdc6 } = args;
  if (!config.analystAutofund.enabled) {
    return { txHash: null, reason: "disabled" };
  }

  const minBalance6 = BigInt(Math.floor(config.analystAutofund.minBalanceUsdc * 1_000_000));
  if (currentBalanceUsdc6 >= minBalance6) {
    return { txHash: null, reason: "already_funded" };
  }

  const wallet = coordinatorWallet();
  if (!wallet) return { txHash: null, reason: "no_coordinator" };

  const day = todayUtc();
  const dripUsd = dripUsdForTier(tier);
  const dripUsdc6 = BigInt(Math.floor(dripUsd * 1_000_000));
  if (dripUsdc6 === 0n) return { txHash: null, reason: "disabled" };

  // Global daily cap check. We read-then-write without a lock; race is OK
  // because the worst-case overshoot is one extra drip per concurrent
  // contest, bounded by the small drip size.
  const spent = await dailySpentUsd(day);
  if (spent + dripUsd > config.analystAutofund.dailyCapUsd) {
    return { txHash: null, reason: "cap_hit" };
  }

  // Per-agent cap is enforced by the unique index on (agent_id, drip_day).
  // Insert a placeholder row first; if it conflicts the agent already got
  // their drip today and we skip without sending the tx.
  const placeholder = await pool.query(
    `insert into analyst_autofund_log (agent_id, operator, drip_day, amount_usd, tx_hash)
     values ($1, $2, $3, $4, $5)
     on conflict (agent_id, drip_day) do nothing
     returning id`,
    [agentId, operator, day, dripUsd, "pending"],
  );
  if (placeholder.rowCount === 0) {
    return { txHash: null, reason: "already_dripped" };
  }
  const rowId = (placeholder.rows[0] as { id: number }).id;

  try {
    // Confirm coordinator wallet has USDC before sending.
    const coordBal = await coordinatorUsdcBalance(wallet.account.address);
    if (coordBal < dripUsdc6) {
      // Roll back the placeholder so a refunded coordinator can drip later.
      await pool.query("delete from analyst_autofund_log where id = $1", [rowId]);
      return { txHash: null, reason: "coord_broke" };
    }

    const hash = await wallet.writeContract({
      address: config.external.USDC,
      abi: usdcMinimalAbi,
      functionName: "transfer",
      args: [hotWalletAddress, dripUsdc6],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    await pool.query(
      "update analyst_autofund_log set tx_hash = $1 where id = $2",
      [hash, rowId],
    );
    return { txHash: hash, reason: "ok" };
  } catch (err) {
    // Drop the placeholder so a retry tomorrow isn't blocked. Tx genuinely
    // failed (revert, RPC error); the agent just doesn't get funded this
    // round.
    await pool.query("delete from analyst_autofund_log where id = $1", [rowId]).catch(() => {});
    console.error(
      `autofund failed agent=${agentId} drip=${dripUsd}USDC: ${err instanceof Error ? err.message : err}`,
    );
    return { txHash: null, reason: "error" };
  }
}

