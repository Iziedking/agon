import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { coordinatorAddress, findDueContests, findOpenContests, openContest, openMission } from "./contestOps.js";
import { runContestById } from "./runContestById.js";
import { findActiveChallenges, resolveChallengeById } from "./runChallengeById.js";
import { startArcanaClaimerLoop } from "../lib/arcanaClaimer.js";
import { pinArcanaMarketsForContest } from "../lib/arcanaPins.js";
import { startTickScheduler } from "./predictionTicks.js";
import { startSyndicateWarSettler } from "./syndicateWar.js";
import { broadcastTelegram } from "../notifications/index.js";
import { startPuzzlePoolTopUp } from "../runners/puzzles/generator.js";
import { setTierGate } from "../lib/tierGate.js";
import { startAdminCommandWorker } from "./adminCommands.js";

/// Self-driving contest loop. With a funded COORDINATOR_PRIVATE_KEY in place, the
/// coordinator opens a contest, streams its standings over the window, funds Scout
/// entrants when needed, settles on-chain (or refunds itself if nobody entered),
/// waits a gap, and opens the next one. The coordinator wallet funds each pool
/// (and recovers it on cancel), so it needs USDC.
///
/// Contests open on a fixed daily schedule, not a tight loop: at each time in
/// AUTOPILOT_CONTEST_TIMES every category opens once, so a category appears only
/// a few times a day. Missions open MISSION_PER_DAY times a day at random inside
/// an active window. Both fire a Telegram alert so operators know a joinable
/// event opened. The due-sweeper still settles everything regardless of cadence.
///
/// Env (all optional, sensible defaults):
///   AUTOPILOT=0                            turn it off even with a key set
///   AUTOPILOT_TYPE=rotate                  pin a single category (solver|analyst|scout) or leave to open all
///   AUTOPILOT_CONTEST_TIMES=08:00,13:00,19:00   times of day each category opens (morning, noon, evening)
///   AUTOPILOT_CONTEST_CATEGORIES=solver,analyst,scout   which categories open at each time
///   AUTOPILOT_CONTEST_MIN_TIER=0           tier gate floor for scheduled contests
///   AUTOPILOT_CONTEST_MAX_TIER=4           tier gate ceiling (default all-tier so anyone can join)
///   AUTOPILOT_CONTEST_STAGGER_SECONDS=30   gap between the per-category opens at one window
///   AUTOPILOT_OPEN_ON_BOOT=0               open one round immediately on start (off by default)
///   SCHEDULE_TZ_OFFSET_HOURS=0             shift all schedule times off UTC (e.g. 1 for WAT)
///   AUTOPILOT_POOL_USDC_MIN=1              lower bound of the randomized pool, USDC
///   AUTOPILOT_POOL_USDC_MAX=10             upper bound of the randomized pool, USDC
///   AUTOPILOT_POOL_USDC=...                legacy single value; if set, used as both min and max
///   AUTOPILOT_DURATION_SECONDS_MIN=1200    lower bound of the join window, seconds (20 min default)
///   AUTOPILOT_DURATION_SECONDS_MAX=2400    upper bound of the join window, seconds (40 min default)
///   AUTOPILOT_DURATION_SECONDS=...         legacy fixed window; if set, used as both min and max
///   MISSION_PER_DAY=2                      missions a day at random (0 = use MISSION_CADENCE_SECONDS instead)
///   MISSION_ACTIVE_HOURS=08:00-22:00       window the random mission times are drawn from
///   MISSION_CADENCE_SECONDS=3600           legacy fixed mission interval, used only when MISSION_PER_DAY=0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// Pick a random integer in [min, max] inclusive. Swaps the bounds if
/// they're inverted in env so a typo can't turn it into a negative range.
function randInt(min: number, max: number): number {
  const lo = Math.floor(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// ===== Daily schedule helpers =====
// The autopilot opens contests at fixed times of day and missions at random
// times of day, instead of a tight interval loop that floods the arena with
// events nobody can keep up with. All times are read against a UTC clock that
// can be shifted by SCHEDULE_TZ_OFFSET_HOURS, so an operator targets their own
// local time without a timezone library (e.g. set it to 1 for WAT).

const SCHEDULE_OFFSET_HOURS = Number(process.env.SCHEDULE_TZ_OFFSET_HOURS ?? "0");
const DAY_MS = 86_400_000;

/// "HH:MM" -> minutes from midnight, or null if malformed.
function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

/// "08:00,13:00,19:00" -> [480, 780, 1140], sorted, malformed entries dropped.
function parseTimesOfDay(spec: string, fallback: number[]): number[] {
  const out = spec
    .split(",")
    .map((s) => parseHHMM(s))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  return out.length > 0 ? out : fallback;
}

/// "08:00-22:00" -> [480, 1320]. Falls back to the whole day on a bad value.
function parseActiveWindow(spec: string): [number, number] {
  const [a, b] = spec.split("-");
  const lo = a ? parseHHMM(a) : null;
  const hi = b ? parseHHMM(b) : null;
  if (lo == null || hi == null || hi <= lo) return [0, 1439];
  return [lo, hi];
}

/// ms from now until today's (offset) instant at `minuteOfDay`. Negative when
/// that minute already passed today.
function msUntilTodayMinute(minuteOfDay: number, offsetHours: number): number {
  const now = Date.now();
  const offMs = offsetHours * 3_600_000;
  const shifted = new Date(now + offMs);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return midnight + minuteOfDay * 60_000 - offMs - now;
}

/// ms from now until the next FUTURE instant whose offset time-of-day is one of
/// `minutesOfDay`. Checks today and tomorrow so it never returns a past time.
function msUntilNextDaily(minutesOfDay: number[], offsetHours: number): number {
  if (minutesOfDay.length === 0) return DAY_MS;
  let best = Infinity;
  for (let day = 0; day <= 1; day++) {
    for (const mod of minutesOfDay) {
      const delay = msUntilTodayMinute(mod, offsetHours) + day * DAY_MS;
      if (delay > 1000 && delay < best) best = delay;
    }
  }
  return best === Infinity ? DAY_MS : best;
}

/// Pick `n` random minutes-of-day spread across [lo, hi]: split the window into
/// n bands and draw one minute per band, so the events are spaced out across
/// the day rather than clustered. Sorted ascending.
function pickSpreadMinutes(n: number, lo: number, hi: number): number[] {
  const span = Math.max(1, hi - lo);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const bandLo = lo + Math.floor((span * i) / n);
    const bandHi = lo + Math.floor((span * (i + 1)) / n) - 1;
    out.push(randInt(bandLo, Math.max(bandLo, bandHi)));
  }
  return out.sort((a, b) => a - b);
}

const ROTATION = ["solver", "analyst", "scout"] as const;
const TYPE_NAMES = ["scout", "analyst", "solver"]; // contract index to name

type ContestKind = (typeof ROTATION)[number];

/// Contests currently being run, so the main loop and the due-sweeper never act
/// on the same contest at once. The check-and-add is synchronous (no await
/// between), so two callers can't both pass the guard for the same id.
const inFlight = new Set<number>();

/// Reject a promise after `ms` so a single hung settlement (a stuck tx because
/// the coordinator wallet is out of Arc gas, or an RPC that never returns)
/// can't freeze the whole sweep loop. The underlying work keeps running in the
/// background; the in-flight guard stops it from being retried while stuck, and
/// the sweeper moves on to other events.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// The whole resolve (live swap/solve race + scoring + the two settlement txs)
// must fit in this budget. The scout race can run up to ~180s (trait-aware
// window) plus ~10s scoring and ~20s for the two chain receipts, so 240s leaves
// margin. The idempotent payout-retry guard makes a timed-out pass resumable.
const RUN_TIMEOUT_MS = Number(process.env.AUTOPILOT_RUN_TIMEOUT_SECONDS ?? "600") * 1000;

async function runOnce(contestId: number, broadcast: (message: unknown) => void): Promise<void> {
  if (inFlight.has(contestId)) return;
  inFlight.add(contestId);
  // Clear the guard only when the REAL work settles, NOT when the watchdog
  // fires. A run that exceeds RUN_TIMEOUT_MS keeps going in the background and
  // KEEPS the in-flight flag, so the sweeper never starts an overlapping run
  // that would fight it for the coordinator nonce — the bug that silently
  // wedged settlement (two concurrent runContestById grabbing the same pending
  // nonce, both txs replacing/reverting, contest stuck OPEN). The bounded
  // on-chain receipt waits guarantee the work eventually settles or fails, so
  // the guard always clears and the next sweep retries cleanly.
  const work = runContestById(contestId, broadcast).finally(() => inFlight.delete(contestId));
  work.catch(() => {}); // background promise; handle eventual rejection so it can't crash the loop
  await withTimeout(work, RUN_TIMEOUT_MS, `contest ${contestId}`).catch((err) => {
    console.error(`autopilot: contest ${contestId} watchdog: ${err instanceof Error ? err.message : err}`);
  });
}

/// Settle a contest to completion through the shared in-flight guard (no
/// watchdog truncation): the admin command worker awaits the full run and
/// reports the outcome. Throws if the contest is already being worked, so a
/// manual trigger never races the sweeper.
export async function settleContestToCompletion(
  contestId: number,
  broadcast: (message: unknown) => void,
): Promise<void> {
  if (inFlight.has(contestId)) throw new Error("contest already being settled");
  inFlight.add(contestId);
  try {
    await runContestById(contestId, broadcast);
  } finally {
    inFlight.delete(contestId);
  }
}

/// Settle any contest whose window has closed, including ones hosted by other
/// operators (the main loop only runs the coordinator's own). Runs concurrently
/// with the open-loop; the in-flight guard keeps them from colliding.
async function startDueSweeper(broadcast: (message: unknown) => void): Promise<void> {
  // Sweep often so a contest's post-close streamed race starts within ~30s of
  // its window closing, not up to a minute later.
  const everyMs = Number(process.env.AUTOPILOT_SWEEP_SECONDS ?? "30") * 1000;
  for (;;) {
    await sleep(everyMs);
    try {
      const due = await findDueContests();
      for (const info of due) {
        if (inFlight.has(info.id)) continue;
        console.log(`autopilot: settling due contest ${info.id}`);
        // Isolated: a throwing/timed-out settlement (runOnce is already bounded)
        // is logged and the loop continues to the next contest.
        try {
          await runOnce(info.id, broadcast);
        } catch (err) {
          console.error(`autopilot: contest ${info.id} settle failed:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.error("autopilot sweeper failed:", err instanceof Error ? err.message : err);
    }
  }
}

/// Peer challenges: lock, score, resolve, and refund-cancel. Separate in-flight
/// set since challenge ids and contest ids are different id spaces.
const challengeInFlight = new Set<number>();

async function resolveChallengeOnce(id: number, broadcast: (message: unknown) => void): Promise<void> {
  if (challengeInFlight.has(id)) return;
  challengeInFlight.add(id);
  // Same single-flight discipline as runOnce: hold the guard until the real
  // work settles so a slow resolve isn't retried concurrently against the same
  // coordinator nonce.
  const work = resolveChallengeById(id, broadcast).finally(() => challengeInFlight.delete(id));
  work.catch(() => {});
  await withTimeout(work, RUN_TIMEOUT_MS, `challenge ${id}`).catch((err) => {
    console.error(`autopilot: challenge ${id} watchdog: ${err instanceof Error ? err.message : err}`);
  });
}

/// Resolve a challenge to completion through the shared guard (no watchdog
/// truncation), for the admin command worker. Throws if already in flight.
export async function resolveChallengeToCompletion(
  id: number,
  broadcast: (message: unknown) => void,
): Promise<void> {
  if (challengeInFlight.has(id)) throw new Error("challenge already being resolved");
  challengeInFlight.add(id);
  try {
    await resolveChallengeById(id, broadcast);
  } finally {
    challengeInFlight.delete(id);
  }
}

async function startChallengeSweeper(broadcast: (message: unknown) => void): Promise<void> {
  // Challenges get a faster sweep than contests: the moment a join window
  // closes (or fills 4/4), we want to lock and start the live race right away,
  // not leave it sitting "window closed, waiting for first frame" for up to a
  // minute. Defaults to 12s; falls back to the shared sweep if that's faster.
  const everyMs =
    Number(process.env.AUTOPILOT_CHALLENGE_SWEEP_SECONDS ?? process.env.AUTOPILOT_SWEEP_SECONDS ?? "12") * 1000;
  for (;;) {
    await sleep(everyMs);
    try {
      const active = await findActiveChallenges();
      for (const id of active) {
        if (challengeInFlight.has(id)) continue;
        // Isolate per-challenge failures (resolveChallengeOnce is already
        // bounded): one stuck challenge can't freeze or starve the loop.
        try {
          await resolveChallengeOnce(id, broadcast);
        } catch (err) {
          console.error(`autopilot: challenge ${id} sweep failed:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.error("autopilot challenge sweeper failed:", err instanceof Error ? err.message : err);
    }
  }
}

const arenaCreateAbi = parseAbi([
  "function createChallenge(uint8 kind, uint128 stake, uint64 maxEntrants, uint64 joinDeadline, uint64 resolveDeadline, bool isPrivate, uint16 minTier, uint16 maxTier) returns (uint256)",
]);

/// Randomly creates peer challenges on the same cadence as contests, so the
/// /live lobby and /challenges page always have something happening even
/// when no human has hosted one. The coordinator auto-fills its own
/// challenges with a second bot entrant via runChallengeById's auto-fill so
/// they actually run instead of cancelling on the join deadline.
///
/// Disabled by default. Set AUTOPILOT_RANDOM_CHALLENGES=1 to enable.
async function startRandomChallengeLoop(broadcast: (message: unknown) => void): Promise<void> {
  const enabled = (process.env.AUTOPILOT_RANDOM_CHALLENGES ?? "0") === "1";
  if (!enabled) return;
  if (!config.coordinator.privateKey) {
    console.warn("autopilot: random challenges enabled but COORDINATOR_PRIVATE_KEY missing; skipping");
    return;
  }

  const stakeMin = Number(process.env.AUTOPILOT_CHALLENGE_STAKE_MIN ?? "0.5");
  const stakeMax = Number(process.env.AUTOPILOT_CHALLENGE_STAKE_MAX ?? "2");
  // Join window: random per cycle inside [min, max]. Legacy single-value
  // env (AUTOPILOT_CHALLENGE_JOIN_SECONDS) is honored as both bounds for
  // back-compat. Default 15-45 min so operators get a real window to join.
  const legacyJoin = process.env.AUTOPILOT_CHALLENGE_JOIN_SECONDS;
  const joinMin = Number(process.env.AUTOPILOT_CHALLENGE_JOIN_SECONDS_MIN ?? legacyJoin ?? "900");
  const joinMax = Number(process.env.AUTOPILOT_CHALLENGE_JOIN_SECONDS_MAX ?? legacyJoin ?? "2700");
  // Resolve window: dense, not dead air. The streamed race fills up to ~180s of
  // real concurrent activity (trait-aware) and stops 60s before this deadline,
  // leaving room for postWinnerRoot. 260s gives the race its full window plus the
  // pre-deadline cushion. The join window above stays host-configurable; only the
  // resolve span is set here.
  // Long enough that the real-swap race (up to ~7 min) plus scoring + the
  // winner-root tx all fit before the resolve deadline forces a refund cancel.
  const resolveSecs = Number(process.env.AUTOPILOT_CHALLENGE_RESOLVE_SECONDS ?? "600");
  // One challenge per cycle. Default 1 hour between creations.
  const cycleSecs = Number(process.env.AUTOPILOT_CHALLENGE_CYCLE_SECONDS ?? "3600");
  const kinds = (process.env.AUTOPILOT_CHALLENGE_KINDS ?? "0,1,2,3")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 3);

  console.log(
    `autopilot: random challenges every ${cycleSecs}s, stake ${stakeMin}-${stakeMax} USDC, join window ${joinMin}-${joinMax}s, kinds ${kinds.join(",")}`,
  );

  const pk = config.coordinator.privateKey.startsWith("0x")
    ? config.coordinator.privateKey
    : `0x${config.coordinator.privateKey}`;
  const wallet = createWalletClient({
    account: privateKeyToAccount(pk as `0x${string}`),
    chain: arcTestnet,
    transport: http(config.rpcHttp),
  });

  // Alternate the tier gate each cycle: even cycles open a lower-tier
  // challenge (0-2), odd cycles a higher-tier one (3-4) with a larger stake.
  const highStakeMult = Number(process.env.AUTOPILOT_CHALLENGE_HIGH_TIER_STAKE_MULT ?? "5");
  let chCycle = 0;
  for (;;) {
    try {
      const highTier = chCycle % 2 === 1;
      const gate = highTier ? { min: 3, max: 4 } : { min: 0, max: 2 };
      const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
      const baseStake = Math.round((stakeMin + Math.random() * (stakeMax - stakeMin)) * 100) / 100;
      const stakeUsdc = highTier ? Math.round(baseStake * highStakeMult * 100) / 100 : baseStake;
      const stake = BigInt(Math.round(stakeUsdc * 1e6));
      const joinSecs = randInt(joinMin, joinMax);
      const now = Math.floor(Date.now() / 1000);
      const joinDeadline = BigInt(now + joinSecs);
      const resolveDeadline = BigInt(now + joinSecs + resolveSecs);
      // Read the id this tx will get BEFORE sending. Safe under the
      // single-writer autopilot; if multiple writers race, the indexer's
      // ChallengeCreated handler also pins, so the pin lands either way.
      const claimingId = (await publicClient.readContract({
        address: config.contracts.ChallengeArena,
        abi: [
          { name: "nextChallengeId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
        ] as const,
        functionName: "nextChallengeId",
      })) as bigint;
      const hash = await wallet.writeContract({
        address: config.contracts.ChallengeArena,
        abi: arenaCreateAbi,
        functionName: "createChallenge",
        args: [kind, stake, 2n, joinDeadline, resolveDeadline, false, gate.min, gate.max],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await setTierGate("challenge", Number(claimingId), gate.min, gate.max).catch(() => {});
      console.log(
        `autopilot: random challenge created id=${claimingId}, kind ${kind}, tier ${gate.min}-${gate.max}, stake ${stakeUsdc} USDC, join ${joinSecs}s`,
      );

      // PREDICTION challenges pin an Arcana market set at create time so
      // every entrant sees the same menu. The indexer also pins on event
      // pickup; this fires first to avoid a race where an early entry
      // arrives before the indexer's pass.
      if (kind === 1) {
        try {
          await pinArcanaMarketsForContest(Number(claimingId), 5);
        } catch (err) {
          console.error(`autopilot: pin arcana failed for challenge ${claimingId}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      console.error("autopilot random challenge failed:", err instanceof Error ? err.message : err);
    }
    chCycle++;
    await sleep(cycleSecs * 1000);
  }
}

/// Long-running background services that the coordinator needs regardless
/// of whether contests come from the autopilot hot-loop or the cadence
/// scheduler: due-sweeper for OPEN contests past their window, challenge
/// sweeper, optional random-challenge generator, Arcana claim sweeper,
/// and the per-agent prediction tick scheduler. Splitting these out lets
/// the cadence scheduler reuse them without re-importing autopilot's
/// open-loop.
/// Opens a platform mission on a cadence (the agent labor market). Off by
/// default; set MISSION_ENABLED=true. The due-sweeper settles each mission like
/// any contest, running the MissionRunner via finalScores. Cadence is
/// MISSION_CADENCE_SECONDS (default 1h); MISSION_DOMAIN picks solver/analyst.
async function startMissionLoop(broadcast: (message: unknown) => void): Promise<void> {
  if (!config.mission.enabled) return;
  if (!config.coordinator.privateKey) {
    console.warn("autopilot: MISSION_ENABLED set but COORDINATOR_PRIVATE_KEY missing; skipping missions");
    return;
  }
  // Rotate the domain so missions vary and rarely repeat back-to-back. If
  // MISSION_DOMAIN is pinned we honour it; otherwise cycle the wired domains
  // (scout is not runnable yet). The LLM picks fresh subjects each time on top
  // of this, so two missions in a row are unlikely to feel the same.
  const pinned = process.env.MISSION_DOMAIN?.toLowerCase();
  const DOMAINS: Array<"solver" | "analyst"> = ["solver", "analyst"];
  let domainIdx = 0;
  // Variable join window (5 / 10 / 15 min). Pool randomizes in poolMin..poolMax.
  // MISSION_POOL_USDC_MIN / _MAX set the band (defaults: min = MISSION_POOL_USDC
  // or 100, max = min). Each mission costs a real USDC pool, so the band is the
  // spend control.
  const WINDOWS = [300, 600, 900];
  const poolMin = Math.max(1, Number(process.env.MISSION_POOL_USDC_MIN ?? Math.max(100, config.mission.poolUsdc)));
  const poolMax = Math.max(poolMin, Number(process.env.MISSION_POOL_USDC_MAX ?? poolMin));

  // Open exactly one mission now. Shared by both scheduling modes.
  async function openOneMission(): Promise<void> {
    try {
      const domain = (pinned ?? DOMAINS[domainIdx++ % DOMAINS.length]!) as "solver" | "analyst" | "scout";
      const windowSecs = WINDOWS[Math.floor(Math.random() * WINDOWS.length)]!;
      const poolUsdc = poolMin + Math.floor(Math.random() * (poolMax - poolMin + 1));
      const contestId = await openMission({
        poolUsdc,
        durationSeconds: windowSecs,
        domain,
        minTier: config.mission.minTier,
      });
      await setTierGate("contest", contestId, config.mission.minTier, 4).catch(() => {});
      broadcast({
        type: "contest_open",
        contestId,
        contestType: "mission",
        endsAt: Date.now() + windowSecs * 1000,
      });
      // Telegram alert to opted-in operators (anyone who linked Telegram). The
      // in-arena alert already rides the WebSocket above; this reaches people
      // who are away. Best-effort, never blocks the loop.
      void broadcastTelegram({
        title: `New mission live · ${poolUsdc} USDC pool`,
        body: `${domain.toUpperCase()} mission #${contestId} is open for ${Math.round(windowSecs / 60)} min. Enter as an operative or grab a specialist seat.`,
        href: `/missions/${contestId}`,
      }).catch(() => {});
      console.log(`autopilot: opened mission ${contestId} (${domain}), ${poolUsdc} USDC, ${windowSecs}s window`);
      // Kick the streaming run now, like contests do at open: runContestById
      // streams the lineup during the join window and settles the instant it
      // closes, instead of leaving the mission for the 30s due-sweeper. The
      // in-flight guard stops the sweeper from double-running it; if this run is
      // lost (a coordinator restart), the sweeper still settles it after close.
      void runOnce(contestId, broadcast)
        .then(() => console.log(`autopilot: mission ${contestId} complete`))
        .catch((err) => console.error(`autopilot: mission ${contestId} run failed:`, err instanceof Error ? err.message : err));
    } catch (err) {
      console.error("autopilot mission open failed:", err instanceof Error ? err.message : err);
    }
  }

  // Default cadence: MISSION_PER_DAY missions a day at random times inside the
  // active window, so the arena gets a couple of real, well-attended missions
  // instead of a steady drip. Set MISSION_PER_DAY=0 to fall back to the legacy
  // fixed-interval cadence (MISSION_CADENCE_SECONDS).
  const perDay = Number(process.env.MISSION_PER_DAY ?? "2");
  if (perDay <= 0) {
    const cadence = Number(process.env.MISSION_CADENCE_SECONDS ?? "3600");
    console.log(`autopilot: missions on (${pinned ?? "rotate solver/analyst"}), every ${cadence}s, pool ${poolMin}-${poolMax} USDC`);
    for (;;) {
      await openOneMission();
      await sleep(cadence * 1000);
    }
  }

  const [activeLo, activeHi] = parseActiveWindow(process.env.MISSION_ACTIVE_HOURS ?? "08:00-22:00");
  console.log(
    `autopilot: missions on (${pinned ?? "rotate solver/analyst"}), ${perDay}/day at random in ${process.env.MISSION_ACTIVE_HOURS ?? "08:00-22:00"} (tz offset ${SCHEDULE_OFFSET_HOURS}h), pool ${poolMin}-${poolMax} USDC`,
  );
  for (;;) {
    // Fresh random slots for the current day, spread across the active window.
    const slots = pickSpreadMinutes(perDay, activeLo, activeHi);
    for (const mod of slots) {
      const wait = msUntilTodayMinute(mod, SCHEDULE_OFFSET_HOURS);
      // A slot already past on the boot day is skipped; the rest still fire.
      if (wait <= 0) continue;
      await sleep(wait);
      await openOneMission();
    }
    // Wait until the start of the next day's window, then draw fresh slots.
    await sleep(msUntilNextDaily([activeLo], SCHEDULE_OFFSET_HOURS) + 1000);
  }
}

export async function startBackgroundServices(
  broadcast: (message: unknown) => void,
): Promise<void> {
  void startDueSweeper(broadcast).catch((err) =>
    console.error(
      "background sweeper crashed:",
      err instanceof Error ? err.message : err,
    ),
  );
  void startChallengeSweeper(broadcast).catch((err) =>
    console.error(
      "background challenge sweeper crashed:",
      err instanceof Error ? err.message : err,
    ),
  );
  void startRandomChallengeLoop(broadcast).catch((err) =>
    console.error(
      "background random challenges crashed:",
      err instanceof Error ? err.message : err,
    ),
  );
  void startArcanaClaimerLoop().catch((err) =>
    console.error(
      "arcana claimer crashed:",
      err instanceof Error ? err.message : err,
    ),
  );
  void startTickScheduler(broadcast).catch((err) =>
    console.error(
      "tick scheduler crashed:",
      err instanceof Error ? err.message : err,
    ),
  );
  // Keep the verified, source-grounded quiz pool stocked off the contest hot
  // path, so solver rounds draw fresh, sourced questions instead of repeating
  // the static bank. No-op when the LLM is unconfigured.
  void startPuzzlePoolTopUp().catch((err) =>
    console.error(
      "puzzle pool top-up crashed:",
      err instanceof Error ? err.message : err,
    ),
  );
  // Hourly syndicate-war settler. Computes the prior-week standings
  // into syndicate_war_results so the scoring path can read top-3 ranks
  // without recomputing on every contest.
  void startSyndicateWarSettler().catch((err) =>
    console.error(
      "syndicate war settler crashed:",
      err instanceof Error ? err.message : err,
    ),
  );
  // Drain the admin ops queue (manual force-settle / resolve / cancel issued
  // from the admin console). Runs here so it shares the coordinator's nonce
  // owner, WS broadcast, and single-flight guard.
  void startAdminCommandWorker(broadcast).catch((err) =>
    console.error(
      "admin command worker crashed:",
      err instanceof Error ? err.message : err,
    ),
  );
  // Optional agent-labor-market missions. No-op unless MISSION_ENABLED=true.
  void startMissionLoop(broadcast).catch((err) =>
    console.error(
      "mission loop crashed:",
      err instanceof Error ? err.message : err,
    ),
  );
}

export async function startAutopilot(broadcast: (message: unknown) => void): Promise<void> {
  const configured = (process.env.AUTOPILOT_TYPE ?? "rotate").toLowerCase();
  const legacyPool = process.env.AUTOPILOT_POOL_USDC;
  const poolMin = Number(process.env.AUTOPILOT_POOL_USDC_MIN ?? legacyPool ?? "1");
  const poolMax = Number(process.env.AUTOPILOT_POOL_USDC_MAX ?? legacyPool ?? "10");
  // Join window: random per cycle inside [min, max]. Legacy single-value
  // env (AUTOPILOT_DURATION_SECONDS) is honored as both bounds for
  // back-compat. Default 3-25 min so the live lobby has time to gather
  // entries without every contest looking identical.
  const legacyDuration = process.env.AUTOPILOT_DURATION_SECONDS;
  // Join/run window per contest: random in [min, max]. Default 20-40 min.
  const durationMin = Number(process.env.AUTOPILOT_DURATION_SECONDS_MIN ?? legacyDuration ?? "1200");
  const durationMax = Number(process.env.AUTOPILOT_DURATION_SECONDS_MAX ?? legacyDuration ?? "2400");

  console.log(
    `autopilot on: ${configured} contests, pool ${poolMin}-${poolMax} USDC, window ${durationMin}-${durationMax}s`,
  );

  // A Scout rotation needs the master mnemonic to fund hot wallets; warn once.
  if ((configured === "scout" || configured === "rotate") && !config.scout.masterMnemonic) {
    console.warn("autopilot: SCOUT_MASTER_MNEMONIC not set; Scout contests will run unfunded");
  }

  // Resume anything this coordinator left OPEN (e.g. after a restart) before
  // opening new contests, so a restart settles the in-flight contest instead of
  // abandoning its escrowed pool.
  try {
    const pending = await findOpenContests(coordinatorAddress());
    if (pending.length > 0) {
      console.log(`autopilot: resuming ${pending.length} open contest(s): ${pending.map((p) => p.id).join(", ")}`);
    }
    for (const info of pending) {
      console.log(`autopilot: resuming contest ${info.id}`);
      broadcast({
        type: "contest_open",
        contestId: info.id,
        contestType: TYPE_NAMES[info.contestType] ?? String(info.contestType),
        endsAt: info.endsAt,
      });
      await runOnce(info.id, broadcast);
      console.log(`autopilot: resumed contest ${info.id} complete`);
    }
  } catch (err) {
    console.error("autopilot: resume scan failed:", err instanceof Error ? err.message : err);
  }

  // Sweepers + Arcana claimer + tick scheduler + random challenges. Same
  // services the cadence scheduler also needs, so they're behind one call.
  await startBackgroundServices(broadcast);

  const lo = Math.min(poolMin, poolMax);
  const hi = Math.max(poolMin, poolMax);
  // Each contest in a tier-gated pair gets its own pool and window.
  const randomPool = () => Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
  // Higher-tier campaigns carry larger pools, since tier 3-4 agents put more
  // funding to work. Multiplier is env-tunable.
  const highTierPoolMult = Number(process.env.AUTOPILOT_HIGH_TIER_POOL_MULT ?? "5");

  // Opens one contest, pins Arcana markets when analyst, records the tier
  // gate, broadcasts contest_open, and kicks off the streaming run WITHOUT
  // blocking the loop (so a second contest can open 15 min later). The run
  // settles itself; failures are logged.
  async function openGated(type: "scout" | "analyst" | "solver", gate: { min: number; max: number }) {
    // Tier 3-4 pools scale up so the higher-tier pool is worth competing for.
    const poolUsdc = gate.min >= 3
      ? Math.round(randomPool() * highTierPoolMult * 100) / 100
      : randomPool();
    const durationSeconds = randInt(durationMin, durationMax);
    const contestId = await openContest({
      type,
      poolUsdc,
      durationSeconds,
      minTier: gate.min,
      maxTier: gate.max,
    });
    // Mirror the gate off-chain too: the settlement-side filter and the entry
    // UI read it without a contract call. The on-chain gate is the enforcer.
    await setTierGate("contest", contestId, gate.min, gate.max).catch(() => {});
    console.log(
      `autopilot: opened ${type} contest ${contestId} (tier ${gate.min}-${gate.max}), ${poolUsdc} USDC, ${durationSeconds}s window`,
    );

    let arcanaMarkets: Array<{ id: number; title: string; category: string; endTime: number }> | undefined;
    if (type === "analyst") {
      const pinned = await pinArcanaMarketsForContest(contestId, 5).catch(() => []);
      if (pinned.length > 0) {
        arcanaMarkets = pinned.map((m) => ({
          id: Number(m.marketId), title: m.title, category: m.category, endTime: Number(m.endTime),
        }));
      }
    }

    broadcast({
      type: "contest_open",
      contestId,
      contestType: type,
      endsAt: Date.now() + durationSeconds * 1000,
      ...(arcanaMarkets ? { arcanaMarkets } : {}),
    });

    // Telegram alert to opted-in operators, the same reach missions get. Sent
    // for every autopilot contest so people who are away know a joinable event
    // just opened. Best-effort; never blocks the open.
    const tierLabel = gate.min === gate.max ? `tier ${gate.min}` : `tier ${gate.min}-${gate.max}`;
    void broadcastTelegram({
      title: `New ${type} contest live · ${poolUsdc} USDC pool`,
      body: `${type.toUpperCase()} contest #${contestId} (${tierLabel}) is open for ${Math.round(durationSeconds / 60)} min. Send an agent in to compete for the pool.`,
      href: `/contests/${contestId}`,
    }).catch(() => {});

    void runOnce(contestId, broadcast)
      .then(() => console.log(`autopilot: contest ${contestId} complete`))
      .catch((err) => console.error(`autopilot: contest ${contestId} run failed:`, err instanceof Error ? err.message : err));
  }

  // Scheduled opens: at each time in AUTOPILOT_CONTEST_TIMES (default morning,
  // noon, evening) open one contest per category, so each category appears a
  // fixed, small number of times a day instead of the arena flooding with
  // events nobody can keep up with. Times read against the SCHEDULE_TZ_OFFSET
  // clock so an operator can target their own local time.
  const contestTimes = parseTimesOfDay(
    process.env.AUTOPILOT_CONTEST_TIMES ?? "08:00,13:00,19:00",
    [480, 780, 1140],
  );
  // Which categories open at each window. A pinned AUTOPILOT_TYPE narrows it to
  // one; otherwise the explicit AUTOPILOT_CONTEST_CATEGORIES list (default all).
  const allCats: ContestKind[] = ["solver", "analyst", "scout"];
  const categories: ContestKind[] =
    configured === "scout" || configured === "analyst" || configured === "solver"
      ? [configured]
      : (process.env.AUTOPILOT_CONTEST_CATEGORIES ?? "solver,analyst,scout")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s): s is ContestKind => (allCats as string[]).includes(s));
  const cats = categories.length > 0 ? categories : allCats;
  // Tier gate every scheduled contest opens with. Default all-tier (0-4) so
  // anyone can join the few events that do open.
  const contestGate = {
    min: Number(process.env.AUTOPILOT_CONTEST_MIN_TIER ?? "0"),
    max: Number(process.env.AUTOPILOT_CONTEST_MAX_TIER ?? "4"),
  };
  // Small stagger between the categories at one window so the open txs don't all
  // contend for the coordinator nonce at once.
  const staggerMs = Number(process.env.AUTOPILOT_CONTEST_STAGGER_SECONDS ?? "30") * 1000;

  const fmtTimes = contestTimes.map(
    (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
  );
  console.log(
    `autopilot schedule: ${cats.join("/")} at ${fmtTimes.join(", ")} (tz offset ${SCHEDULE_OFFSET_HOURS}h), tier ${contestGate.min}-${contestGate.max}`,
  );

  // Open one full window's worth of contests (one per category, staggered).
  async function openWindow(): Promise<void> {
    for (const type of cats) {
      try {
        await openGated(type, contestGate);
      } catch (err) {
        console.error("autopilot window open failed:", err instanceof Error ? err.message : err);
      }
      await sleep(staggerMs);
    }
  }

  // Optional: open one round immediately on boot so a fresh deploy isn't a dead
  // arena until the next window. Off by default to honour "no surprise opens".
  if ((process.env.AUTOPILOT_OPEN_ON_BOOT ?? "0") === "1") {
    await openWindow();
  }

  for (;;) {
    await sleep(msUntilNextDaily(contestTimes, SCHEDULE_OFFSET_HOURS));
    await openWindow();
    // Step past the fired minute so the next msUntilNextDaily targets the next
    // window, not this one again.
    await sleep(90_000);
  }
}
