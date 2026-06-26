import { query } from "../db/pool.js";

/// Wipes all mission history so the index and the economy start fresh. Deletes
/// the mission-only tables; the on-chain contests remain (we can't un-create
/// them), but a cleared mission simply stops being a mission and the coordinator
/// ignores it. Mission x402 nanopayments are removed; contest research
/// nanopayments are left untouched. Use for a clean demo reset.
///
/// Requires DATABASE_URL. Run from backend/ (or in the coordinator container):
///   npm run missions:clear
async function main() {
  // Mission x402 spend first (needs the missions list to scope it), so we don't
  // touch ordinary contest research payments.
  const np = await query("delete from nanopayments where contest_id in (select contest_id from missions)");
  console.log(`[missions:clear] cleared mission nanopayments (${np.rowCount ?? 0} rows)`);

  // a2a_trades are mission-only (agent-to-agent intel buys).
  const tables = [
    "a2a_trades",
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
    console.log(`[missions:clear] cleared ${t} (${r.rowCount ?? 0} rows)`);
  }
  console.log("[missions:clear] done — mission history reset; new missions start clean");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[missions:clear] failed:", err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
