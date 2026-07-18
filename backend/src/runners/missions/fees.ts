import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Account } from "viem";
import { arcTestnet, publicClient } from "../../chain/arc.js";
import { config } from "../../config/index.js";
import { query } from "../../db/pool.js";
import { notify } from "../../notifications/index.js";

const fmtUsdc = (amount: bigint) => `${(Number(amount) / 1e6).toFixed(2)} USDC`;

/// v2 economy join-fee settlement (docs/missions.md s1c). When a mission cancels
/// with no qualifier, the operatives' join fees are returned from the treasury
/// (which received them). Both helpers are safe to call on any contest: they
/// no-op when there are no recorded fees / the row is not a mission.

const USDC_ABI = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

/// Refund every unrefunded operative join fee for a mission, from the treasury.
export async function refundMissionFees(contestId: number): Promise<void> {
  if (!config.treasury.privateKey || !config.treasury.address) return;
  const { rows } = await query<{ operator: string; amount_usdc_6: string }>(
    "select operator, amount_usdc_6 from mission_operative_fees where contest_id = $1 and refunded = false",
    [contestId],
  );
  if (rows.length === 0) return;

  const account = privateKeyToAccount(config.treasury.privateKey) as Account;
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(config.rpcHttp) });
  let refunded = 0;
  for (const r of rows) {
    const amount = BigInt(r.amount_usdc_6 || "0");
    if (amount <= 0n) continue;
    try {
      const hash = await wallet.writeContract({
        address: config.external.USDC,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [r.operator as `0x${string}`, amount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("refund tx reverted");
      await query(
        "update mission_operative_fees set refunded = true, refund_tx = $3 where contest_id = $1 and operator = $2",
        [contestId, r.operator, hash],
      );
      void notify(r.operator, {
        kind: "balance_credit",
        title: "Join fee refunded",
        body: `${fmtUsdc(amount)} returned to your wallet — mission #${contestId} cancelled with no winner. No claim needed.`,
        href: `/missions/${contestId}`,
        context: { contestId, amount6: amount.toString(), txHash: hash, kind: "join_fee_refund" },
      });
      refunded += 1;
    } catch (err) {
      console.error(`[mission ${contestId}] fee refund -> ${r.operator} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`[mission ${contestId}] refunded ${refunded}/${rows.length} operative join fee(s) from the treasury`);
}

/// Participation refund (docs/missions.md s4b). At a SETTLED mission, an operative
/// that put at least `minFrac` of its funded float to work on real settled spend
/// (A2A intel buys + x402 makes) earns its FULL join fee back from the treasury.
/// Idlers keep paying full freight. Volume (scout swaps) is NOT spend and is
/// excluded — a scout operative earns the fee back on the intel it bought, not the
/// swaps it recirculated. Idempotent on `refunded = false`; only ever runs on a
/// paying mission (a cancelled one refunds every fee anyway), so it never races the
/// cancel path. `floatUsdc` is the float ACTUALLY funded per operative (post-cap).
export async function refundParticipationFees(
  contestId: number,
  operatives: Array<{ agentId: number; operator: string }>,
  floatUsdc: number,
  minFrac: number,
): Promise<void> {
  if (!config.treasury.privateKey || !config.treasury.address) return;
  if (operatives.length === 0 || floatUsdc <= 0 || minFrac <= 0) return;
  const float6 = BigInt(Math.round(floatUsdc * 1e6));
  // threshold = float * minFrac, in 6-dec, using integer math (minFrac to /1000).
  const threshold6 = (float6 * BigInt(Math.round(minFrac * 1000))) / 1000n;
  if (threshold6 <= 0n) return;

  const account = privateKeyToAccount(config.treasury.privateKey) as Account;
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(config.rpcHttp) });
  let refunded = 0;
  for (const op of operatives) {
    // Real settled spend by this operative: A2A intel buys + x402 makes.
    const { rows: sp } = await query<{ spent6: string }>(
      `select (
         coalesce((select sum(price_usdc_6::numeric) from a2a_trades where contest_id=$1 and buyer_agent_id=$2 and status='settled'),0)
       + coalesce((select sum(usdc_amount_6::numeric) from nanopayments where contest_id=$1 and agent_id=$2 and status='settled'),0)
       )::text as spent6`,
      [contestId, op.agentId],
    );
    const spent6 = BigInt((sp[0]?.spent6 ?? "0").split(".")[0] || "0");
    if (spent6 < threshold6) continue;

    // Refund this operative's full, not-yet-refunded join fee (once).
    const { rows: fee } = await query<{ amount_usdc_6: string }>(
      "select amount_usdc_6 from mission_operative_fees where contest_id=$1 and lower(operator)=lower($2) and refunded=false",
      [contestId, op.operator],
    );
    const amount = BigInt(fee[0]?.amount_usdc_6 || "0");
    if (amount <= 0n) continue;
    try {
      const hash = await wallet.writeContract({
        address: config.external.USDC,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [op.operator as `0x${string}`, amount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("refund tx reverted");
      await query(
        "update mission_operative_fees set refunded=true, refund_tx=$3, refund_reason='participation' where contest_id=$1 and lower(operator)=lower($2)",
        [contestId, op.operator, hash],
      );
      void notify(op.operator, {
        kind: "balance_credit",
        title: "Join fee earned back",
        body: `${fmtUsdc(amount)} returned — you put your float to work on mission #${contestId}. No claim needed.`,
        href: `/missions/${contestId}`,
        context: { contestId, amount6: amount.toString(), txHash: hash, kind: "participation_refund" },
      });
      refunded += 1;
    } catch (err) {
      console.error(`[mission ${contestId}] participation refund -> ${op.operator} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (refunded > 0) {
    console.log(`[mission ${contestId}] participation: refunded ${refunded} operative join fee(s) for putting >=${Math.round(minFrac * 100)}% of float to work`);
  }
}

/// Refund every unrefunded specialist intel purchase for a mission, from the
/// treasury (which received the base price). Called when a mission cancels, so a
/// specialist who bought a piece on a void mission is made whole.
export async function refundMissionBuys(contestId: number): Promise<void> {
  if (!config.treasury.privateKey || !config.treasury.address) return;
  const { rows } = await query<{ operator: string; fragment_id: string; base_price_6: string }>(
    "select operator, fragment_id, base_price_6 from mission_intel_buys where contest_id = $1 and refunded = false",
    [contestId],
  );
  if (rows.length === 0) return;

  const account = privateKeyToAccount(config.treasury.privateKey) as Account;
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(config.rpcHttp) });
  let refunded = 0;
  for (const r of rows) {
    const amount = BigInt(r.base_price_6 || "0");
    if (amount <= 0n) continue;
    try {
      const hash = await wallet.writeContract({
        address: config.external.USDC,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [r.operator as `0x${string}`, amount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("refund tx reverted");
      await query(
        "update mission_intel_buys set refunded = true, refund_tx = $3 where contest_id = $1 and fragment_id = $2",
        [contestId, r.fragment_id, hash],
      );
      void notify(r.operator, {
        kind: "balance_credit",
        title: "Intel purchase refunded",
        body: `${fmtUsdc(amount)} returned to your wallet — mission #${contestId} cancelled. No claim needed.`,
        href: `/missions/${contestId}`,
        context: { contestId, amount6: amount.toString(), txHash: hash, kind: "intel_buy_refund" },
      });
      refunded += 1;
    } catch (err) {
      console.error(`[mission ${contestId}] intel-buy refund -> ${r.operator} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`[mission ${contestId}] refunded ${refunded}/${rows.length} specialist intel purchase(s) from the treasury`);
}

/// Refund every cancelled mission with unrefunded fees/buys (or just `onlyId`).
/// Idempotent. Shared by the backfill script and the /admin console.
export async function refundAllCancelledMissions(onlyId?: number): Promise<string> {
  let ids: number[];
  if (onlyId != null && Number.isFinite(onlyId) && onlyId > 0) {
    ids = [onlyId];
  } else {
    const { rows } = await query<{ contest_id: string }>(
      `select distinct m.contest_id from missions m
        where m.status = 'cancelled'
          and (exists (select 1 from mission_operative_fees f where f.contest_id = m.contest_id and f.refunded = false)
            or exists (select 1 from mission_intel_buys b where b.contest_id = m.contest_id and b.refunded = false))
        order by m.contest_id`,
    );
    ids = rows.map((r) => Number(r.contest_id));
  }
  if (ids.length === 0) return "nothing to refund";
  for (const id of ids) {
    await refundMissionFees(id);
    await refundMissionBuys(id);
  }
  return `refunded ${ids.length} cancelled mission(s): ${ids.join(", ")}`;
}

/// Wipes all mission history (mission tables + mission x402 spend + A2A trades).
/// On-chain contests remain; a cleared mission is just ignored. Shared by the
/// clear script and the /admin console.
export async function clearMissionHistory(): Promise<string> {
  const np = await query("delete from nanopayments where contest_id in (select contest_id from missions)");
  let total = np.rowCount ?? 0;
  const tables = [
    "a2a_trades",
    "mission_withdrawals",
    "mission_intel_buys",
    "mission_operative_fees",
    "mission_decisions",
    "mission_submissions",
    "mission_specialists",
    "mission_fragments",
    "mission_subjects",
    "missions",
  ];
  for (const t of tables) {
    const r = await query(`delete from ${t}`);
    total += r.rowCount ?? 0;
  }
  // Restart the display numbering so the next mission is MISSION 001 again.
  try {
    await query("select setval('mission_display_seq', 1, false)");
  } catch {
    /* sequence may not exist on an older DB; harmless */
  }
  return `mission history cleared (${total} rows)`;
}

/// Stamp a mission's lifecycle status. No-op for non-mission contests (the update
/// touches zero rows), so it is safe to call on every settlement.
export async function markMissionStatus(contestId: number, status: "settled" | "cancelled"): Promise<void> {
  try {
    await query("update missions set status = $2 where contest_id = $1", [contestId, status]);
  } catch (err) {
    console.error(`[mission ${contestId}] status update failed: ${err instanceof Error ? err.message : err}`);
  }
}
