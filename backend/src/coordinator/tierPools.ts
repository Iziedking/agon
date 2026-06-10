import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { usdcToInt6, int6ToUsdcString } from "../nanopayments/index.js";

/// Tier pools point every Solver agent at a Circle Agent wallet that pays
/// for x402 research per puzzle. The wallet is created once by the operator
/// (`circle wallet create --type agent`) and its address is pinned in
/// `NANOPAY_WALLET_ADDRESS`. Per-tier caps stay enforced in code because
/// Circle's native `wallet limit set` policy is mainnet-only.
///
/// Why a Circle Agent wallet instead of a Circle Dev-Controlled wallet:
/// `circle services pay` only signs for wallets the CLI is logged into;
/// it cannot drive a Dev-Controlled wallet (those use a separate entity
/// secret managed by the backend). For v1 we run one shared agent wallet
/// across tiers; the per-puzzle cap differentiates tier behavior. Adding
/// per-tier wallets is a future enhancement and only requires reading
/// per-tier addresses from env.

const TIERS = [0, 1, 2, 3, 4] as const;
type Tier = (typeof TIERS)[number];

export interface TierPool {
  tier: Tier;
  walletAddress: `0x${string}`;
  /// Session research budget remaining, seeded from
  /// NANOPAY_SESSION_BUDGET_USDC at provisioning and decremented by the
  /// runners as calls settle. Soft cap only — the CLI refuses calls when
  /// the agent wallet's Gateway balance can't cover the seller's price.
  balanceUsdc6: bigint;
  perPuzzleCap6: bigint;
}

let cache: Map<Tier, TierPool> | null = null;

/// Idempotent. Reads NANOPAY_WALLET_ADDRESS, builds one TierPool per tier
/// (all pointing at the same wallet), and persists a row per tier so the
/// admin surface can show "what wallet did the Solver spend from".
export async function ensureTierPools(): Promise<void> {
  if (cache) return;

  if (!config.nanopay.enabled) {
    console.log("[tier-pools] NANOPAY_ENABLED=false; skipping");
    cache = new Map();
    return;
  }
  const wallet = config.nanopay.walletAddress;
  if (!wallet) {
    console.warn(
      "[tier-pools] NANOPAY_WALLET_ADDRESS is not set. " +
        "Create a Circle Agent wallet with `circle wallet create --type agent` " +
        "and paste its address into the env. Research-spend will no-op until then.",
    );
    cache = new Map();
    return;
  }

  const next = new Map<Tier, TierPool>();
  const sessionBudget6 = usdcToInt6(config.nanopay.sessionBudgetUsdc);
  for (const tier of TIERS) {
    const perPuzzleCap6 = usdcToInt6(config.nanopay.perPuzzleByTier[tier] ?? 0);
    const pool: TierPool = {
      tier,
      walletAddress: wallet,
      balanceUsdc6: sessionBudget6,
      perPuzzleCap6,
    };
    next.set(tier, pool);
    await persistRow(pool);
  }

  cache = next;
  logSummary(next);
}

/// Returns the tier pool for an agent's tier, or null if unavailable.
export function getTierPool(tier: number): TierPool | null {
  if (!cache) return null;
  const t = clampTier(tier);
  return cache.get(t) ?? null;
}

/// Records lifetime spend on a tier pool. Called by the runner after each
/// settled `payX402`.
export async function recordTierPoolSpend(tier: number, usdc6: bigint): Promise<void> {
  if (usdc6 <= 0n) return;
  const t = clampTier(tier);
  await query(
    `update tier_pool_state
       set lifetime_spend_6 = (coalesce(lifetime_spend_6, '0')::numeric + $2::numeric)::text,
           last_updated_at = now()
     where tier = $1`,
    [t, usdc6.toString()],
  ).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[tier-pools] recordTierPoolSpend failed: ${msg}`);
  });
}

/// Stubbed for API parity with the previous SDK-backed implementation —
/// Gateway balance lives on Circle's servers, not on chain at the wallet
/// address, so there's nothing to refresh here. Kept as a no-op so callers
/// (the runner's settle path) don't need a conditional.
export async function refreshTierPoolBalance(_tier: number): Promise<void> {
  return;
}

function clampTier(t: number): Tier {
  if (t <= 0) return 0;
  if (t >= 4) return 4;
  return Math.floor(t) as Tier;
}

async function persistRow(pool: TierPool): Promise<void> {
  await query(
    `insert into tier_pool_state
       (tier, wallet_address, wallet_id, balance_usdc_6, per_puzzle_cap_6, last_updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (tier) do update set
       wallet_address  = excluded.wallet_address,
       wallet_id       = excluded.wallet_id,
       balance_usdc_6  = excluded.balance_usdc_6,
       per_puzzle_cap_6 = excluded.per_puzzle_cap_6,
       last_updated_at = now()`,
    [
      pool.tier,
      pool.walletAddress,
      null,
      pool.balanceUsdc6.toString(),
      pool.perPuzzleCap6.toString(),
    ],
  );
}

function logSummary(map: Map<Tier, TierPool>): void {
  if (map.size === 0) {
    console.log("[tier-pools] no pools provisioned");
    return;
  }
  const first = map.get(0);
  console.log(
    `[tier-pools] ready: wallet ${first?.walletAddress ?? "?"} (shared across tiers 0-4)`,
  );
  for (const tier of TIERS) {
    const p = map.get(tier);
    if (!p) continue;
    console.log(
      `  tier ${tier} cap: ${int6ToUsdcString(p.perPuzzleCap6)} USDC/puzzle`,
    );
  }
}
