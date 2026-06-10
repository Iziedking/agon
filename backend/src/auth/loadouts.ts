import { query } from "../db/pool.js";
import { TRAITS, traitById } from "./traits.js";

/// Trait loadout rules per docs/agentTier.md.
///
/// Limits:
///   - max 3 equipped traits per entry
///   - certain trait pairs clash and can't be equipped together
///   - max 3 simultaneous live entries per profile (across contests + challenges)
///   - one agent per profile per event (no Sybil within a single pool)

export const MAX_EQUIPPED = 3;

/// Hardcoded clash pairs. Adding a new clash is one row here. The
/// reasoning per pair is in the doc; the rule of thumb is "two traits
/// that pull the scoring math in incompatible directions clash."
const CLASH_PAIRS: Array<[string, string]> = [
  // Pure-dice routing clashes with careful calibration
  ["lucky_charm", "pattern_reader"],
  ["lucky_charm", "oracle_eye"],
  ["lucky_charm", "precision_engine"],
  ["dice_roller", "precision_engine"],
  // Two routing traits at once - first wins, but they still clash to keep
  // the equip choice sharp
  ["hot_hand", "lucky_charm"],
  ["lucky_charm", "circle_protocol"],
  ["deep_state", "lucky_charm"],
  // Universal vs specialised - pick a side
  ["chain_breaker", "deep_state"],
  ["arc_sovereign", "circle_protocol"],
  // Volume strategy conflicts
  ["volume_titan", "gas_whisperer"],
];

export function traitsClash(a: string, b: string): boolean {
  if (a === b) return false;
  for (const [x, y] of CLASH_PAIRS) {
    if ((x === a && y === b) || (x === b && y === a)) return true;
  }
  return false;
}

export interface LoadoutValidation {
  ok: boolean;
  reason?: string;
}

/// Validates a candidate loadout. Used by the loadout endpoint and by the
/// runner as a defensive check (a stale row from before a rule change
/// shouldn't break a contest, just gets clipped to a valid subset).
export function validateLoadout(traitIds: string[]): LoadoutValidation {
  const trimmed = (traitIds ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (trimmed.length > MAX_EQUIPPED) {
    return { ok: false, reason: `at most ${MAX_EQUIPPED} traits per entry` };
  }
  const seen = new Set<string>();
  for (const id of trimmed) {
    if (seen.has(id)) return { ok: false, reason: "duplicate trait in loadout" };
    seen.add(id);
    if (!traitById(id)) return { ok: false, reason: `unknown trait: ${id}` };
  }
  for (let i = 0; i < trimmed.length; i++) {
    for (let j = i + 1; j < trimmed.length; j++) {
      if (traitsClash(trimmed[i]!, trimmed[j]!)) {
        return { ok: false, reason: `${trimmed[i]} and ${trimmed[j]} clash` };
      }
    }
  }
  return { ok: true };
}

/// Persist a loadout. Caller must have already verified that the operator
/// owns the agent and owns each of the equipped traits (the agent_traits
/// table is the source of truth for ownership).
export async function setLoadout(
  source: "contest" | "challenge",
  eventId: number,
  agentId: number,
  operator: string,
  traitIds: string[],
): Promise<void> {
  await query(
    `insert into entry_loadouts (source, event_id, agent_id, operator, trait_ids)
       values ($1, $2, $3, $4, $5)
       on conflict (source, event_id, agent_id)
       do update set trait_ids = excluded.trait_ids, operator = excluded.operator`,
    [source, eventId, agentId, operator.toLowerCase(), traitIds],
  );
}

export async function getLoadout(
  source: "contest" | "challenge",
  eventId: number,
  agentId: number,
): Promise<string[]> {
  const { rows } = await query<{ trait_ids: string[] | null }>(
    "select trait_ids from entry_loadouts where source = $1 and event_id = $2 and agent_id = $3",
    [source, eventId, agentId],
  );
  return rows[0]?.trait_ids ?? [];
}

/// Returns the trait ids the operator currently owns across all their
/// agents. The trait pool is profile-level: any trait owned by any of the
/// operator's agents is available for any agent to equip.
export async function ownedTraitPool(operator: string): Promise<string[]> {
  const { rows } = await query<{ trait_id: string }>(
    `select distinct at.trait_id
       from agent_traits at
       join agents a on a.id = at.agent_id
      where a.owner = $1`,
    [operator.toLowerCase()],
  );
  return rows.map((r) => r.trait_id);
}

export const TRAIT_CATALOGUE = TRAITS;

/// Count contests and challenges this operator currently has live entries
/// in. Live = the event hasn't settled or cancelled yet.
export async function liveEntryCount(operator: string): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `select (
       (select count(*) from entries e
          join contests c on c.id = e.contest_id
         where e.operator = $1
           and (c.status = 'open' or c.status = 'scoring'))
       +
       (select count(*) from challenge_entries ce
          join challenges ch on ch.id = ce.challenge_id
         where ce.operator = $1
           and (ch.status = 'open' or ch.status = 'locked'))
     )::text as n`,
    [operator.toLowerCase()],
  );
  return Number(rows[0]?.n ?? "0");
}

/// Live entries for one surface only. The cap is 3 live contests AND 3 live
/// challenges per operator (counted separately), so a busy operator can hold
/// up to six live entries total, three of each kind.
export async function liveEntryCountForSurface(
  operator: string,
  surface: "contest" | "challenge",
): Promise<number> {
  const op = operator.toLowerCase();
  if (surface === "contest") {
    const { rows } = await query<{ n: string }>(
      `select count(*)::text as n from entries e
         join contests c on c.id = e.contest_id
        where e.operator = $1 and (c.status = 'open' or c.status = 'scoring')`,
      [op],
    );
    return Number(rows[0]?.n ?? "0");
  }
  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from challenge_entries ce
       join challenges ch on ch.id = ce.challenge_id
      where ce.operator = $1 and (ch.status = 'open' or ch.status = 'locked')`,
    [op],
  );
  return Number(rows[0]?.n ?? "0");
}

/// True if this operator already has any agent entered in this event.
export async function hasAgentInEvent(
  source: "contest" | "challenge",
  eventId: number,
  operator: string,
): Promise<boolean> {
  if (source === "contest") {
    const { rows } = await query<{ n: string }>(
      "select count(*)::text as n from entries where contest_id = $1 and operator = $2",
      [eventId, operator.toLowerCase()],
    );
    return Number(rows[0]?.n ?? "0") > 0;
  }
  const { rows } = await query<{ n: string }>(
    "select count(*)::text as n from challenge_entries where challenge_id = $1 and operator = $2",
    [eventId, operator.toLowerCase()],
  );
  return Number(rows[0]?.n ?? "0") > 0;
}
