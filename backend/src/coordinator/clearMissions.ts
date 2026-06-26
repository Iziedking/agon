import { clearMissionHistory } from "../runners/missions/fees.js";

/// Wipes all mission history so the index and the economy start fresh. Deletes
/// the mission-only tables; the on-chain contests remain (we can't un-create
/// them), but a cleared mission simply stops being a mission and the coordinator
/// ignores it. Mission x402 nanopayments are removed; contest research
/// nanopayments are left untouched. Use for a clean demo reset.
///
/// Requires DATABASE_URL. Run from backend/ (or in the coordinator container):
///   npm run missions:clear
async function main() {
  const summary = await clearMissionHistory();
  console.log(`[missions:clear] ${summary} — new missions start clean`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[missions:clear] failed:", err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
