import { query } from "../db/pool.js";

/// Final standings snapshot for replay. The coordinator saves the last
/// standings frame when an event settles; the live page reads it back so a
/// settled or already-finished event reconstructs its full result (volumes,
/// ops, tx hashes, solver cells, research spend) for anyone who didn't watch it
/// live. The shape persisted is exactly the `entries` array broadcast on the
/// wire, so the frontend renders it identically to the final live frame.

/// Save (upsert) the final standings for an event. Best-effort: a failure here
/// must never block settlement, so it only logs.
export async function saveStandingsSnapshot(
  source: "contest" | "challenge",
  eventId: number,
  entries: unknown,
): Promise<void> {
  try {
    await query(
      `insert into event_standings (source, event_id, entries, settled_at)
         values ($1, $2, $3::jsonb, now())
         on conflict (source, event_id) do update
           set entries = excluded.entries, settled_at = excluded.settled_at`,
      [source, eventId, JSON.stringify(entries ?? [])],
    );
  } catch (err) {
    console.warn("[standingsSnapshot] save failed", source, eventId, err);
  }
}
