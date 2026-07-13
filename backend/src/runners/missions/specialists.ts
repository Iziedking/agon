/// Platform-seeded specialist (intel-seller) agents. Each specialist holds the
/// captured intel for one mission fragment and quotes a price; it serves that
/// intel over the A2A handshake (a2a.ts) when an operative chooses BUY. Specialist
/// agentIds sit on a reserved range (MISSION_SPECIALIST_AGENT_ID_BASE) so their
/// derived hot wallets never collide with a real operator agent. v1 specialists
/// are platform-run; operator-run resale sellers are a later phase (todo.md).

import { deriveHotWallet } from "../scout.js";
import { config } from "../../config/index.js";
import { query } from "../../db/pool.js";
import type { Commission, MissionFragment, Specialist } from "./types.js";

/// USDC 6-decimals from a whole-USDC decimal.
function toUsdc6(whole: number): bigint {
  return BigInt(Math.round(whole * 1e6));
}

/// Per-kind multiplier on the base intel price: a hand-curated web fact is worth
/// more than a raw market value. Tunable; keeps the market from being flat.
const PRICE_MULTIPLIER: Record<string, number> = {
  intel: 1.0,
  signal: 0.8,
  market: 0.6,
  action: 0,
};

/// Action fragments are sourced on-chain (scout domain), never bought from a
/// specialist; everything else is buyable.
function isBuyable(f: MissionFragment): boolean {
  return f.kind !== "action";
}

/// Seeds the platform specialists for a mission: one specialist agent per buyable
/// fragment, each holding that fragment's captured intel and quoting a price.
/// Idempotent (re-seeding upserts), so it is safe to call before every run.
export async function seedSpecialists(mission: Commission): Promise<Specialist[]> {
  const base = config.mission.specialistAgentIdBase;
  const seeded: Specialist[] = [];
  let idx = 0;
  for (const f of mission.fragments) {
    if (!isBuyable(f)) continue;
    const agentId = base + idx;
    idx += 1;
    const account = deriveHotWallet(agentId);
    // v2: the platform shelf sells every piece at the mission's base price `b`
    // (set by weight). A small per-kind multiplier still nudges decisive pieces
    // up. Specialists buy from this shelf at `b` and resell at their own price.
    const price6 = BigInt(Math.round(Number(mission.basePrice6) * (PRICE_MULTIPLIER[f.kind] ?? 1)));
    const intel = f.truth ?? null;
    await query(
      `insert into mission_specialists (contest_id, agent_id, address, fragment_id, price_usdc_6, intel)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (contest_id, agent_id, fragment_id)
       do update set address = excluded.address,
                     price_usdc_6 = excluded.price_usdc_6,
                     intel = excluded.intel`,
      [
        mission.missionId,
        agentId,
        account.address.toLowerCase(),
        f.id,
        price6.toString(),
        JSON.stringify(intel),
      ],
    );
    seeded.push({
      agentId,
      address: account.address,
      missionId: mission.missionId,
      fragmentId: f.id,
      price6: price6.toString(),
      // Seeded here means a house market-maker, so its ask is negotiable. Operator
      // listings are written by the listing flow and stay firm.
      owner: "platform",
      intel,
    });
  }
  return seeded;
}

/// Every specialist that can sell a given fragment, ordered the way the buyer
/// should prefer them: real operators first (their A2A sale is the point of the
/// two-sided market), then cheapest, then a stable agentId. The A2A buy walks
/// this list and takes the first seller the operative can actually afford, so an
/// overpriced operator listing degrades to a cheaper platform seller instead of
/// failing the buy and cancelling the mission.
export async function listSpecialistsForFragment(
  missionId: number,
  fragmentId: string,
): Promise<Specialist[]> {
  const { rows } = await query<{
    agent_id: string;
    address: string;
    price_usdc_6: string;
    owner: string | null;
    intel: unknown;
  }>(
    `select agent_id, address, price_usdc_6, owner, intel
       from mission_specialists
      where contest_id = $1 and fragment_id = $2
        and (owner = 'operator' or claimed_by is null)
      order by (owner = 'operator') desc, price_usdc_6::numeric asc, agent_id asc`,
    [missionId, fragmentId],
  );
  return rows.map((r) => ({
    agentId: Number(r.agent_id),
    address: r.address as `0x${string}`,
    missionId,
    fragmentId,
    price6: r.price_usdc_6,
    owner: r.owner === "operator" ? ("operator" as const) : ("platform" as const),
    intel: r.intel,
  }));
}

/// The single best specialist for a fragment (first of listSpecialistsForFragment),
/// or null when none exists. Used where only the headline price/availability
/// matters (mission listing, float sizing); the buy path uses the full list.
export async function getSpecialistForFragment(
  missionId: number,
  fragmentId: string,
): Promise<Specialist | null> {
  const all = await listSpecialistsForFragment(missionId, fragmentId);
  return all[0] ?? null;
}
