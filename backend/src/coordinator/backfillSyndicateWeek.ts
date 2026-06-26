import { query } from "../db/pool.js";
import { recordSyndicateContributions } from "./reputation.js";
import type { AgentResult } from "../runners/types.js";

/// One-off backfill: replay THIS ISO-week's settled events through the
/// syndicate-contribution recorder, so the work already done this week counts
/// toward the current war and the tiles stop reading 0.
///
/// Lives in src/coordinator (NOT src/scripts) on purpose: the repo's .gitignore
/// has a blanket `scripts/` rule, so a file under any scripts/ dir is never
/// committed — which means it never reaches the prod image (Dockerfile COPY . ./
/// copies the git checkout). Keeping it here guarantees it ships.
///
/// Why it's needed: the coordinator only started recording syndicate
/// contributions after the fix landed, so events that settled earlier this week
/// never rolled their reputation into syndicates. We have the final standings of
/// every settled event in `event_standings` ({rank, agentId, operator, score}),
/// which is exactly what recordSyndicateContributions needs (it re-ranks by
/// score and records on-chain for operators currently in a syndicate).
///
/// Requires DATABASE_URL and COORDINATOR_PRIVATE_KEY (it does the on-chain
/// recordContribution writes, same as live settlement). Run from backend/:
///   npm run backfill:syndicate-week
async function main() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // Monday 00:00 UTC

  console.log(`backfill: replaying events settled since ${start.toISOString()} (this ISO week)`);

  const { rows } = await query<{ source: string; event_id: string; entries: unknown }>(
    "select source, event_id::text as event_id, entries from event_standings where settled_at >= $1 order by settled_at asc",
    [start.toISOString()],
  );
  console.log(`backfill: found ${rows.length} settled event(s) this week`);

  let processed = 0;
  for (const row of rows) {
    const raw = Array.isArray(row.entries) ? (row.entries as Array<Record<string, unknown>>) : [];
    const results: AgentResult[] = raw
      .map((e) => ({
        agentId: Number(e.agentId),
        operator: String(e.operator ?? "") as `0x${string}`,
        score: Number(e.score) || 0,
        detail: {},
      }))
      .filter((r) => Number.isFinite(r.agentId) && r.operator.startsWith("0x"));
    if (results.length === 0) continue;
    await recordSyndicateContributions(Number(row.event_id), results);
    processed++;
  }

  console.log(
    `backfill: done — replayed ${processed} event(s). syndicate reputation now reflects this week's member results.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
