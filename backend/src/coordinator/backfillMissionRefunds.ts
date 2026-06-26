import { query } from "../db/pool.js";
import { refundMissionFees, refundMissionBuys } from "../runners/missions/fees.js";

/// One-off backfill: refund the operative join fees and specialist intel
/// purchases for every CANCELLED mission that still has unrefunded rows.
///
/// Why it's needed: auto-refund-on-cancel only shipped with the v2 join layer,
/// so missions that cancelled BEFORE it deployed (e.g. 943, 945) took the
/// operatives' fees but never returned them. This replays the refund for any
/// such mission.
///
/// Idempotent: refundMissionFees / refundMissionBuys only touch rows where
/// refunded = false and flip the flag after a successful on-chain transfer, so
/// running this twice never double-refunds. Lives in src/coordinator (NOT
/// src/scripts, which .gitignore drops) so it ships in the prod image.
///
/// Requires DATABASE_URL and TREASURY_PRIVATE_KEY (the refunds are signed by the
/// treasury, which received the fees). Run from backend/:
///   npm run backfill:mission-refunds
/// or target one mission:  MISSION_ID=943 npm run backfill:mission-refunds
async function main() {
  const only = process.env.MISSION_ID ? Number(process.env.MISSION_ID) : null;

  let ids: number[];
  if (only != null && Number.isFinite(only)) {
    ids = [only];
  } else {
    const { rows } = await query<{ contest_id: string }>(
      `select distinct m.contest_id
         from missions m
        where m.status = 'cancelled'
          and (
            exists (select 1 from mission_operative_fees f where f.contest_id = m.contest_id and f.refunded = false)
            or exists (select 1 from mission_intel_buys b where b.contest_id = m.contest_id and b.refunded = false)
          )
        order by m.contest_id`,
    );
    ids = rows.map((r) => Number(r.contest_id));
  }

  if (ids.length === 0) {
    console.log("[backfill-refunds] nothing to refund");
    return;
  }
  console.log(`[backfill-refunds] refunding ${ids.length} cancelled mission(s): ${ids.join(", ")}`);
  for (const id of ids) {
    await refundMissionFees(id);
    await refundMissionBuys(id);
  }
  console.log("[backfill-refunds] done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-refunds] failed:", err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
