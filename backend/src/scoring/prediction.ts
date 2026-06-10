/// Pure scoring functions for the prediction-tick model. Three scoring
/// modes (PNL_MTM, PNL_REALIZED, VOLUME) all share these primitives.
///
/// Design contract: every function in this file is deterministic, has no
/// side effects, and operates on plain values. The tick runner threads
/// these primitives through the per-agent tick loop; tests in
/// backend/scripts/prediction-examples.ts walk every scenario and assert.

export type ScoringMode = "pnl_mtm" | "pnl_realized" | "volume";

export type StatName = "POWER" | "PRECISION" | "SPEED" | "ENDURANCE" | "LUCK" | "FOCUS";
export type StatLevels = Partial<Record<StatName, number>>;

/// Trait ids the tick model knows about. Matches the trait slugs in
/// backend/src/auth/traits.ts. Unknown traits are silently ignored.
export type RelevantTrait =
  | "quick-trigger"
  | "hedge-master"
  | "diamond-hands"
  | "calibrated"
  | "lucky-charm";

// ===========================================================================
// Tick budget: how many decisions an agent makes during the trade window.
// ===========================================================================

/// Per-tier base ticks. Index 0 = tier 0 (ineligible), index 4 = tier 4.
const TIER_BASE_TICKS = [0, 1, 2, 4, 8] as const;
const SPEED_LEVELS_PER_TICK = 5;
const SPEED_TICK_CAP = 4;
const QUICK_TRIGGER_BONUS = 2;

/// Compute how many decision ticks the agent gets across the trade window.
/// Tier sets the base, SPEED stat adds +1 per 5 levels (capped at +4), and
/// the Quick Trigger trait adds +2 on top. Tier 0 is ineligible; returns 0.
export function tickBudget(
  tier: number,
  stats: StatLevels = {},
  equipped: readonly string[] = [],
): number {
  const t = Math.max(0, Math.min(4, Math.floor(tier)));
  if (t === 0) return 0;
  const base = TIER_BASE_TICKS[t]!;
  const speedLevel = Math.max(0, Math.min(20, stats.SPEED ?? 0));
  const speedBonus = Math.min(SPEED_TICK_CAP, Math.floor(speedLevel / SPEED_LEVELS_PER_TICK));
  const traitBonus = equipped.includes("quick-trigger") ? QUICK_TRIGGER_BONUS : 0;
  return base + speedBonus + traitBonus;
}

/// Trait-based discount on hedge stake. Hedge Master halves the cost of a
/// hedge bet (the runner divides the agent's intended hedge stake by 2
/// before submitting the on-chain trade). Returns 0.5 or 1.0.
export function hedgeCostMultiplier(equipped: readonly string[] = []): number {
  return equipped.includes("hedge-master") ? 0.5 : 1.0;
}

// ===========================================================================
// Position + market state primitives.
// ===========================================================================

export interface Position {
  marketId: number;
  side: "yes" | "no";
  /// USDC 6-dec actually paid for this stake. Hedge Master's discount is
  /// already applied at submit time, so this is the real on-chain stake.
  stakeUsdc6: bigint;
  /// Entry pools at the moment the agent's `buyShares` tx landed. Drives
  /// the mtm "edge appreciation since entry" formula.
  entryYesPool: bigint;
  entryNoPool: bigint;
}

export interface MarketState {
  marketId: number;
  /// Current pools (used for mtm) OR final pools at resolution (used for
  /// realized PnL). Caller passes whichever snapshot they're scoring on.
  yesPool: bigint;
  noPool: bigint;
  resolved: boolean;
  /// true = YES won, false = NO won, null = unresolved.
  outcome: boolean | null;
  cancelled: boolean;
}

/// Implied probability of YES from a pool snapshot. Returns 0.5 when both
/// pools are zero (no information yet).
export function impliedYesProb(yesPool: bigint, noPool: bigint): number {
  const sum = yesPool + noPool;
  if (sum === 0n) return 0.5;
  return Number((yesPool * 10000n) / sum) / 10000;
}

// ===========================================================================
// PnL: mtm and realized.
// ===========================================================================

/// Marked-to-market PnL for one position. Uses the "edge appreciation since
/// entry" formula: pnl = stake × (currentSideProb - entrySideProb) /
/// entrySideProb. Positive when the position's side has gotten more likely;
/// negative when it's drifted the wrong way.
///
/// Why this formula instead of parimutuel payout: parimutuel expected
/// payout is always stake (zero-sum in expectation), so it can't drive a
/// useful mtm score. Edge appreciation captures how the market moved
/// since entry and rewards agents who timed correctly.
///
/// Cancelled markets return 0 (the on-chain refund handles the cash).
export function positionMtmPnl(p: Position, m: MarketState): bigint {
  if (m.cancelled) return 0n;
  const entryYes = impliedYesProb(p.entryYesPool, p.entryNoPool);
  const currentYes = impliedYesProb(m.yesPool, m.noPool);
  const entrySide = p.side === "yes" ? entryYes : 1 - entryYes;
  const currentSide = p.side === "yes" ? currentYes : 1 - currentYes;
  if (entrySide <= 0) return 0n;
  const ratio = (currentSide - entrySide) / entrySide;
  return BigInt(Math.round(Number(p.stakeUsdc6) * ratio));
}

/// Realized PnL for one position once the market resolves. Parimutuel
/// payout: winning side gets stake × (totalPool / winningPool) gross,
/// minus stake = net. Losing side gets −stake. Cancelled = 0 (refunded
/// directly by Arcana, not counted in pool scoring).
export function positionRealizedPnl(p: Position, m: MarketState): bigint {
  if (m.cancelled) return 0n;
  if (!m.resolved || m.outcome === null) return positionMtmPnl(p, m);
  const winningSide: "yes" | "no" = m.outcome ? "yes" : "no";
  if (p.side !== winningSide) return -p.stakeUsdc6;
  const winningPool = winningSide === "yes" ? m.yesPool : m.noPool;
  if (winningPool === 0n) return 0n;
  const total = m.yesPool + m.noPool;
  const grossPayout = (p.stakeUsdc6 * total) / winningPool;
  return grossPayout - p.stakeUsdc6;
}

/// Net PnL for an agent across all positions in the round. Hedges are
/// additive: if you bought $5 YES and then $2 NO on the same market, both
/// positions resolve independently and the net is the sum. mode picks
/// mtm vs realized.
export function agentNetPnl(
  positions: Position[],
  markets: MarketState[],
  mode: "mtm" | "realized",
): bigint {
  const byId = new Map(markets.map((m) => [m.marketId, m]));
  let total = 0n;
  for (const p of positions) {
    const m = byId.get(p.marketId);
    if (!m) continue;
    total += mode === "mtm" ? positionMtmPnl(p, m) : positionRealizedPnl(p, m);
  }
  return total;
}

/// Sum of stakes across all positions an agent took. Used by VOLUME mode.
export function agentVolume(positions: Position[]): bigint {
  return positions.reduce((acc, p) => acc + p.stakeUsdc6, 0n);
}

// ===========================================================================
// Pool payouts.
// ===========================================================================

export interface Payout {
  operator: `0x${string}`;
  amount: bigint;
}

interface PnlAgent {
  operator: `0x${string}`;
  pnlUsdc6: bigint;
  hasPosition: boolean;
}

/// PnL-weighted payout used by PNL_MTM and PNL_REALIZED modes.
/// 30% participation share split flat across all who took a position.
/// 70% performance share weighted by positive PnL (agents with PnL ≤ 0
/// only get the participation slice). If no one has positive PnL, the
/// 70% gets sprinkled flat too so the pool isn't stranded.
///
/// Rounding residual lands on the largest share so the sum equals
/// claimable exactly. Output is sorted by amount descending.
export function pnlWeightedPayouts(agents: PnlAgent[], claimable: bigint): Payout[] {
  const qualified = agents.filter((a) => a.hasPosition);
  if (qualified.length === 0) return [];

  const participationPool = (claimable * 30n) / 100n;
  const pnlPool = claimable - participationPool;
  const baseShare = participationPool / BigInt(qualified.length);

  const positive = qualified.filter((a) => a.pnlUsdc6 > 0n);
  const pnlTotal = positive.reduce((acc, a) => acc + a.pnlUsdc6, 0n);

  const byOp = new Map<`0x${string}`, bigint>();
  for (const a of qualified) {
    byOp.set(a.operator, (byOp.get(a.operator) ?? 0n) + baseShare);
  }
  if (positive.length > 0 && pnlTotal > 0n) {
    let allocated = 0n;
    // Sort positives by PnL desc so the largest winner soaks the residual.
    const sorted = [...positive].sort((a, b) => (b.pnlUsdc6 > a.pnlUsdc6 ? 1 : -1));
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!;
      const share =
        i === 0
          ? pnlPool - allocated - sorted.slice(1).reduce((sum, x) => sum + (pnlPool * x.pnlUsdc6) / pnlTotal, 0n)
          : (pnlPool * a.pnlUsdc6) / pnlTotal;
      if (i > 0) allocated += share;
      byOp.set(a.operator, (byOp.get(a.operator) ?? 0n) + share);
    }
  } else {
    const extra = pnlPool / BigInt(qualified.length);
    let allocated = 0n;
    for (let i = 0; i < qualified.length; i++) {
      const a = qualified[i]!;
      const share = i === qualified.length - 1 ? pnlPool - allocated : extra;
      allocated += extra;
      byOp.set(a.operator, (byOp.get(a.operator) ?? 0n) + share);
    }
  }

  return Array.from(byOp.entries())
    .map(([operator, amount]) => ({ operator, amount }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

interface VolumeAgent {
  operator: `0x${string}`;
  volumeUsdc6: bigint;
}

/// VOLUME mode payout: 100% by stake volume share. Agents who didn't
/// trade get nothing (volume is participation). Rounding residual lands
/// on the largest share.
export function volumeWeightedPayouts(agents: VolumeAgent[], claimable: bigint): Payout[] {
  const positive = agents.filter((a) => a.volumeUsdc6 > 0n);
  if (positive.length === 0) return [];
  const total = positive.reduce((acc, a) => acc + a.volumeUsdc6, 0n);
  if (total === 0n) return [];

  const sorted = [...positive].sort((a, b) => (b.volumeUsdc6 > a.volumeUsdc6 ? 1 : -1));
  let allocated = 0n;
  const result: Payout[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    const share =
      i === 0
        ? claimable - sorted.slice(1).reduce((sum, x) => sum + (claimable * x.volumeUsdc6) / total, 0n)
        : (claimable * a.volumeUsdc6) / total;
    if (i > 0) allocated += share;
    result.push({ operator: a.operator, amount: share });
  }
  return result;
}

/// Top-level dispatch by scoring mode. Returns the payout leaves the
/// coordinator's Merkle root + settlement path consumes.
export function computePredictionPayouts(
  mode: ScoringMode,
  agents: Array<{
    operator: `0x${string}`;
    positions: Position[];
    pnlUsdc6?: bigint;
  }>,
  markets: MarketState[],
  claimable: bigint,
): Payout[] {
  if (mode === "volume") {
    return volumeWeightedPayouts(
      agents.map((a) => ({ operator: a.operator, volumeUsdc6: agentVolume(a.positions) })),
      claimable,
    );
  }
  const pnlMode: "mtm" | "realized" = mode === "pnl_realized" ? "realized" : "mtm";
  return pnlWeightedPayouts(
    agents.map((a) => ({
      operator: a.operator,
      pnlUsdc6: a.pnlUsdc6 ?? agentNetPnl(a.positions, markets, pnlMode),
      hasPosition: a.positions.length > 0,
    })),
    claimable,
  );
}
