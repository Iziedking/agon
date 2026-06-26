import { query } from "../db/pool.js";

/// Concurrency rules across every event type (missions, contests, challenges):
///   1. One agent per event — an agent committed to an active event can't join
///      another (so each of an operator's events runs on a distinct agent).
///   2. An operator may be in at most MAX_CONCURRENT_EVENTS active events at once.
///
/// "Active" = a contest that is open/scoring (missions ride contests, so a
/// mission operative entry is just a contest entry), a challenge that is
/// open/locked, or an open mission the agent holds a specialist seat in.

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_EVENTS ?? "3");

export interface EntryCheck {
  ok: boolean;
  reason?: string;
  activeEvents: number;
  cap: number;
}

/// Is this agent already committed to an active event? `excludeContestId` lets a
/// re-entry into the SAME contest pass (the agent is allowed to stay where it is).
async function agentBusy(agentId: number, operator: string, excludeContestId?: number): Promise<boolean> {
  const inContest = await query(
    `select 1 from entries e join contests ct on ct.id = e.contest_id
      where e.agent_id = $1 and ct.status in ('open','scoring')
        ${excludeContestId != null ? "and e.contest_id <> $2" : ""}
      limit 1`,
    excludeContestId != null ? [agentId, excludeContestId] : [agentId],
  );
  if (inContest.rows.length > 0) return true;

  const inChallenge = await query(
    `select 1 from challenge_entries ce join challenges chl on chl.id = ce.challenge_id
      where ce.agent_id = $1 and chl.status in ('open','locked') limit 1`,
    [agentId],
  );
  if (inChallenge.rows.length > 0) return true;

  const asSpecialist = await query(
    `select 1 from mission_intel_buys b join missions m on m.contest_id = b.contest_id
      where b.agent_id = $1 and lower(b.operator) = $2 and m.status = 'open' limit 1`,
    [agentId, operator],
  );
  return asSpecialist.rows.length > 0;
}

/// How many distinct active events the operator is committed to right now.
async function operatorActiveEvents(operator: string): Promise<number> {
  const r = await query<{ n: string }>(
    `select (
       (select count(distinct e.contest_id) from entries e join contests ct on ct.id = e.contest_id
         where lower(e.operator) = $1 and ct.status in ('open','scoring'))
       + (select count(distinct ce.challenge_id) from challenge_entries ce join challenges chl on chl.id = ce.challenge_id
         where lower(ce.operator) = $1 and chl.status in ('open','locked'))
       + (select count(distinct b.contest_id) from mission_intel_buys b join missions m on m.contest_id = b.contest_id
         where lower(b.operator) = $1 and m.status = 'open')
     )::text as n`,
    [operator],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/// Decides whether an operator may enter a new event with a given agent.
export async function checkEntry(
  operator: string,
  agentId: number,
  opts?: { contestId?: number },
): Promise<EntryCheck> {
  const op = operator.toLowerCase();
  const cap = MAX_CONCURRENT;

  if (await agentBusy(agentId, op, opts?.contestId)) {
    return {
      ok: false,
      reason: "that agent is already in another active event — one agent per event",
      activeEvents: 0,
      cap,
    };
  }

  const activeEvents = await operatorActiveEvents(op);
  // Re-entering an event the operator is already in (same contest) does not add a
  // new event, so only block a genuinely new one once they're at the cap.
  const alreadyInThis =
    opts?.contestId != null
      ? (
          await query("select 1 from entries where contest_id = $1 and lower(operator) = $2 limit 1", [
            opts.contestId,
            op,
          ])
        ).rows.length > 0
      : false;
  if (!alreadyInThis && activeEvents >= cap) {
    return {
      ok: false,
      reason: `you're already in ${activeEvents} active events — max ${cap} at once`,
      activeEvents,
      cap,
    };
  }

  return { ok: true, activeEvents, cap };
}
