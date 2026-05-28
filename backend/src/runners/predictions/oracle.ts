import { parseAbi } from "viem";
import { seededRng } from "../rng.js";
import { publicClient } from "../../chain/arc.js";
import { config } from "../../config/index.js";

/// Builds a set of binary prediction questions from a live Arc snapshot.
/// The LLM doesn't have direct chain access; it has to guess (tier 0/1),
/// reason from priors (tier 2), or look up the answer via web_search
/// (tier 4) to do better than chance. That's the demo edge: paying for
/// tier 4 literally buys real-time chain awareness.
///
/// Ground truth comes from the same snapshot used to phrase the question,
/// so judging is deterministic: read once at round start, use that value
/// for both the threshold and the answer. Scoring uses Brier on the
/// agent's stated confidence.

const NEXT_CONTEST_ABI = parseAbi(["function nextContestId() view returns (uint256)"]);
const NEXT_CHALLENGE_ABI = parseAbi(["function nextChallengeId() view returns (uint256)"]);
const NEXT_AGENT_ABI = parseAbi(["function nextAgentId() view returns (uint256)"]);
const USDC_BAL_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

export interface PredictionQuestion {
  /// Short id for the audit row (e.g. "block", "gas", "contests").
  kind: PredictionKind;
  /// Human-readable text the LLM reads.
  prompt: string;
  /// Ground truth: 1 = YES is correct, 0 = NO is correct.
  outcome: 0 | 1;
  /// Captured snapshot value, useful for the audit row and the live stage.
  snapshot: string;
}

export type PredictionKind = "block" | "gas" | "contests" | "challenges" | "agents" | "escrow";

/// Read a battery of live Arc stats in parallel. Each may fail (e.g. a
/// contract isn't deployed in CI); we tolerate that and just skip that
/// question kind. The returned snapshot's keys reflect what succeeded.
interface Snapshot {
  blockNumber?: bigint;
  gasPriceGwei?: bigint;
  contestsMinted?: bigint;
  challengesCreated?: bigint;
  agentsMinted?: bigint;
  escrowUsdc6?: bigint;
}

async function readSnapshot(): Promise<Snapshot> {
  const safe = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    try { return await fn(); } catch { return undefined; }
  };
  const [blockNumber, gasPriceWei, contestsMinted, challengesCreated, agentsMinted, escrowUsdc6] =
    await Promise.all([
      safe(() => publicClient.getBlockNumber()),
      safe(() => publicClient.getGasPrice()),
      safe(() =>
        publicClient.readContract({
          address: config.contracts.ContestEngine,
          abi: NEXT_CONTEST_ABI,
          functionName: "nextContestId",
        }) as Promise<bigint>,
      ),
      safe(() =>
        publicClient.readContract({
          address: config.contracts.ChallengeArena,
          abi: NEXT_CHALLENGE_ABI,
          functionName: "nextChallengeId",
        }) as Promise<bigint>,
      ),
      safe(() =>
        publicClient.readContract({
          address: config.contracts.AgentRegistry,
          abi: NEXT_AGENT_ABI,
          functionName: "nextAgentId",
        }) as Promise<bigint>,
      ),
      safe(() =>
        publicClient.readContract({
          address: config.external.USDC,
          abi: USDC_BAL_ABI,
          functionName: "balanceOf",
          args: [config.contracts.PrizeEscrow],
        }) as Promise<bigint>,
      ),
    ]);

  return {
    blockNumber,
    gasPriceGwei: gasPriceWei != null ? gasPriceWei / 1_000_000_000n : undefined,
    contestsMinted,
    challengesCreated,
    agentsMinted,
    escrowUsdc6,
  };
}

/// Generate N prediction questions deterministically from the seed. Each
/// question's threshold sits within +/- 5% of the live value so YES and
/// NO are both plausible; ground truth is computed from the actual value.
export async function generatePredictionQuestions(
  seed: number,
  count: number,
): Promise<PredictionQuestion[]> {
  const snap = await readSnapshot();
  const r = seededRng(seed);
  const out: PredictionQuestion[] = [];

  const candidates: Array<() => PredictionQuestion | null> = [
    () => buildBlock(snap, r),
    () => buildGas(snap, r),
    () => buildContests(snap, r),
    () => buildChallenges(snap, r),
    () => buildAgents(snap, r),
    () => buildEscrow(snap, r),
  ];

  while (out.length < count) {
    const pick = candidates[Math.floor(r() * candidates.length)]!();
    if (pick) {
      out.push(pick);
    } else if (out.length === 0 && candidates.every((c) => c() === null)) {
      // No chain reads succeeded at all; give the caller a heads-up so it
      // falls back gracefully instead of producing zero predictions.
      throw new Error("no chain snapshot available to build predictions");
    }
    // bounded loop safety
    if (out.length > count * 4) break;
  }
  return out.slice(0, count);
}

function jitter(r: () => number, value: bigint, pct: number): bigint {
  const sign = r() < 0.5 ? -1n : 1n;
  const delta = (value * BigInt(Math.max(1, Math.floor(pct * 100)))) / 10000n;
  const moved = value + sign * delta;
  return moved < 0n ? 0n : moved;
}

function buildBlock(snap: Snapshot, r: () => number): PredictionQuestion | null {
  if (snap.blockNumber == null) return null;
  const threshold = jitter(r, snap.blockNumber, 0.05);
  const outcome: 0 | 1 = snap.blockNumber > threshold ? 1 : 0;
  return {
    kind: "block",
    prompt: `Is the current Arc Testnet block number above ${threshold.toString()}?`,
    outcome,
    snapshot: snap.blockNumber.toString(),
  };
}

function buildGas(snap: Snapshot, r: () => number): PredictionQuestion | null {
  if (snap.gasPriceGwei == null) return null;
  const threshold = jitter(r, snap.gasPriceGwei, 0.15);
  const outcome: 0 | 1 = snap.gasPriceGwei < threshold ? 1 : 0;
  return {
    kind: "gas",
    prompt: `Is the current Arc Testnet gas price below ${threshold.toString()} Gwei?`,
    outcome,
    snapshot: `${snap.gasPriceGwei.toString()} gwei`,
  };
}

function buildContests(snap: Snapshot, r: () => number): PredictionQuestion | null {
  if (snap.contestsMinted == null) return null;
  const threshold = jitter(r, snap.contestsMinted, 0.2);
  const outcome: 0 | 1 = snap.contestsMinted > threshold ? 1 : 0;
  return {
    kind: "contests",
    prompt: `Has ArcRun listed more than ${threshold.toString()} contests on Arc Testnet so far?`,
    outcome,
    snapshot: snap.contestsMinted.toString(),
  };
}

function buildChallenges(snap: Snapshot, r: () => number): PredictionQuestion | null {
  if (snap.challengesCreated == null) return null;
  const threshold = jitter(r, snap.challengesCreated, 0.2);
  const outcome: 0 | 1 = snap.challengesCreated > threshold ? 1 : 0;
  return {
    kind: "challenges",
    prompt: `Have ArcRun operators created more than ${threshold.toString()} peer challenges on Arc Testnet so far?`,
    outcome,
    snapshot: snap.challengesCreated.toString(),
  };
}

function buildAgents(snap: Snapshot, r: () => number): PredictionQuestion | null {
  if (snap.agentsMinted == null) return null;
  const threshold = jitter(r, snap.agentsMinted, 0.2);
  const outcome: 0 | 1 = snap.agentsMinted > threshold ? 1 : 0;
  return {
    kind: "agents",
    prompt: `Have more than ${threshold.toString()} ArcRun agent NFTs been minted on Arc Testnet so far?`,
    outcome,
    snapshot: snap.agentsMinted.toString(),
  };
}

function buildEscrow(snap: Snapshot, r: () => number): PredictionQuestion | null {
  if (snap.escrowUsdc6 == null) return null;
  // Convert from 6dp to dollars for the prompt.
  const dollars = Number(snap.escrowUsdc6) / 1_000_000;
  const thresholdDollars = Math.max(1, Math.round(dollars * (0.7 + 0.6 * r())));
  const outcome: 0 | 1 = dollars > thresholdDollars ? 1 : 0;
  return {
    kind: "escrow",
    prompt: `Does ArcRun's PrizeEscrow contract currently hold more than ${thresholdDollars} USDC on Arc Testnet?`,
    outcome,
    snapshot: `$${dollars.toFixed(2)}`,
  };
}
