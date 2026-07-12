/// Autonomous agents: agents that own themselves and act on their own account.
///
/// The contracts force this shape. `ContestEngine.registerEntry` requires
/// `msg.sender == agentRegistry.ownerOfAgent(agentId)` and enforces one entry per
/// OWNER per contest. So an agent entered by a human is spending that human's
/// single seat, and a human can never field a whole roster. An agent that owns
/// itself is its own operator, and a field can be made of agents.
///
/// So each autonomous agent gets a Circle Developer-Controlled Wallet. That wallet
/// calls `createAgent()`, which mints the ERC-8004 identity NFT to itself. From
/// then on the wallet IS the agent's owner: it signs the agent's entries, holds the
/// agent's USDC, and pays the agent's costs. Circle DCW is doing exactly what it is
/// for here, key management for agent-initiated transactions.
///
/// The agent starts poor and unskilled. Every tick it reads the open contests,
/// looks at its own balance and its remaining budget, and decides with its OWN tier
/// model what to do: enter something, sit this one out, or spend its earnings
/// buying itself a better brain (`upgradeAgent`: 12, then 60, then 240 USDC for
/// solver). That is a real capital allocation decision between competing now and
/// investing in future capability, and no part of it is scripted.
///
/// Every decision, including the model's stated reason, is written to
/// `agent_decisions` so we can show WHY an agent acted rather than only that it did.
///
/// Hard guarantees, because this spends money:
///   - An agent can never spend beyond `budget_usdc_6`. Checked before every call.
///   - It never enters a contest it is already in, or whose tier gate excludes it.
///   - Off by default (`AGENT_AUTONOMY_ENABLED`), so it cannot disturb anything.

import { parseAbi } from "viem";

import { publicClient } from "../chain/arc.js";
import {
  circleDevConfigured,
  createWalletOnChain,
  executeContractCall,
  getTxState,
  seedTestnetUsdc,
} from "../chain/circleDev.js";
import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { callModel } from "../runners/llm/client.js";
import { modelForTier, fallbackModelForTier } from "../runners/llm/tierConfig.js";

const engineAbi = parseAbi([
  "function getContest(uint256 contestId) view returns ((uint8,uint8,uint16,uint16,uint16,address,address,bytes32,uint64,uint64,uint256,bytes32,uint16,uint16))",
]);

const registryAbi = parseAbi([
  "function getTier(uint256 agentId, uint8 cType) view returns (uint16)",
  "function upgradePrice(uint8 cType, uint16 fromTier) view returns (uint256)",
]);

const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

/// ContestType enum, matching contracts/src/types/ArcRunTypes.sol.
const TYPE_NAME = ["SCOUT", "ANALYST", "SOLVER"] as const;

interface Autonomous {
  id: string;
  agentId: number | null;
  walletId: string;
  address: `0x${string}`;
  label: string;
  budget6: bigint;
  spent6: bigint;
}

interface OpenContest {
  contestId: number;
  cType: number;
  pool6: bigint;
  minTier: number;
  maxTier: number;
  endsInSec: number;
}

interface Decision {
  action: "enter" | "skip" | "upgrade";
  contestId?: number;
  upgradeType?: number;
  reason: string;
}

async function loadFleet(): Promise<Autonomous[]> {
  const { rows } = await query<{
    id: string;
    agent_id: string | null;
    wallet_id: string;
    address: string;
    label: string;
    budget_usdc_6: string;
    spent_usdc_6: string;
  }>(
    `select id, agent_id, wallet_id, address, label, budget_usdc_6, spent_usdc_6
       from autonomous_agents where enabled = true order by id`,
  );
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id == null ? null : Number(r.agent_id),
    walletId: r.wallet_id,
    address: r.address as `0x${string}`,
    label: r.label,
    budget6: BigInt(r.budget_usdc_6),
    spent6: BigInt(r.spent_usdc_6),
  }));
}

async function note(
  a: Autonomous,
  kind: Decision["action"] | "error",
  reason: string,
  contestId?: number,
  cost6 = 0n,
  txHash?: string,
): Promise<void> {
  await query(
    `insert into agent_decisions (agent_id, address, kind, contest_id, reason, cost_usdc_6, tx_hash)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [a.agentId, a.address, kind, contestId ?? null, reason.slice(0, 600), cost6.toString(), txHash ?? null],
  );
}

/// Wait for a Circle transaction to land, returning its on-chain hash. Circle
/// submits asynchronously, so the id is not a hash until it is broadcast.
async function settle(txId: string, timeoutMs = 90_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const st = await getTxState(txId);
    if (st.state === "FAILED" || st.state === "CANCELLED") {
      throw new Error(`circle tx ${st.state}: ${st.errorReason ?? "unknown"}`);
    }
    if (st.txHash) return st.txHash;
    if (Date.now() > deadline) throw new Error("circle tx timed out before broadcast");
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/// Bring the fleet up to strength. Each new agent gets a Circle wallet, a faucet
/// top-up so it can pay Arc's USDC gas, and then mints its own identity NFT by
/// calling createAgent() from that wallet. It ends up owning itself.
export async function provisionFleet(): Promise<void> {
  if (!circleDevConfigured()) {
    console.warn("[autonomy] Circle DCW is not configured; cannot provision self-owned agents.");
    return;
  }
  const want = config.autonomy.count;
  const { rows } = await query<{ n: string }>("select count(*)::text as n from autonomous_agents");
  const have = Number(rows[0]?.n ?? "0");
  if (have >= want) return;

  for (let i = have; i < want; i++) {
    const label = `AUTO-${String(i + 1).padStart(2, "0")}`;
    try {
      const { walletId, address } = await createWalletOnChain(`autonomous:${label}`, "ARC-TESTNET");
      // USDC is gas on Arc, so a wallet with nothing cannot even transact.
      await seedTestnetUsdc(address).catch(() => ({ requested: false }));

      await query(
        `insert into autonomous_agents (wallet_id, address, label, budget_usdc_6)
         values ($1, $2, $3, $4)`,
        [walletId, address, label, BigInt(Math.round(config.autonomy.budgetUsdc * 1e6)).toString()],
      );
      console.log(`[autonomy] ${label} wallet ${address} provisioned (funding from faucet)`);
    } catch (err) {
      console.error(`[autonomy] provisioning ${label} failed:`, err instanceof Error ? err.message : err);
      return;
    }
  }
}

/// An agent with a wallet but no identity mints its own. createAgent() sets
/// owner = msg.sender, so the wallet ends up holding the agent's ERC-8004 NFT.
async function mintSelf(a: Autonomous): Promise<void> {
  const uri = `https://arcrun.xyz/agent/${a.label}`;
  const { id } = await executeContractCall({
    walletId: a.walletId,
    contractAddress: config.contracts.AgentRegistry,
    abiFunctionSignature: "createAgent(string)",
    abiParameters: [uri],
    refId: `mint:${a.label}`,
  });
  const hash = await settle(id);

  // The indexer writes the agent row from the AgentCreated event. Read our new
  // agentId back by owner rather than parsing logs here.
  for (let i = 0; i < 20; i++) {
    const { rows } = await query<{ id: string }>("select id from agents where lower(owner) = lower($1) limit 1", [
      a.address,
    ]);
    if (rows[0]) {
      await query("update autonomous_agents set agent_id = $2 where id = $1", [a.id, rows[0].id]);
      a.agentId = Number(rows[0].id);
      console.log(`[autonomy] ${a.label} minted agent #${a.agentId} (tx ${hash})`);
      await note(a, "enter", `minted its own identity, agent #${a.agentId}`, undefined, 0n, hash);
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("createAgent landed but the agent row never appeared");
}

/// Open contests this agent could legally enter right now.
async function openContestsFor(a: Autonomous): Promise<OpenContest[]> {
  const { rows } = await query<{ id: string }>(
    `select c.id from contests c
      where c.status = 'open'
        and not exists (select 1 from entries e
                        where e.contest_id = c.id and lower(e.operator) = lower($1))
      order by c.id desc limit 12`,
    [a.address],
  );

  const out: OpenContest[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const r of rows) {
    try {
      const c = (await publicClient.readContract({
        address: config.contracts.ContestEngine,
        abi: engineAbi,
        functionName: "getContest",
        args: [BigInt(r.id)],
      })) as unknown as readonly [
        number, number, number, number, number, string, string, string,
        bigint, bigint, bigint, string, number, number,
      ];
      const status = Number(c[1]);
      const endTime = Number(c[9]);
      if (status !== 0) continue; // not OPEN
      if (endTime <= now + 30) continue; // about to close, no time to act
      out.push({
        contestId: Number(r.id),
        cType: Number(c[0]),
        pool6: c[10],
        minTier: Number(c[12]),
        maxTier: Number(c[13]),
        endsInSec: endTime - now,
      });
    } catch {
      /* RPC blip: skip this one on this tick */
    }
  }
  return out;
}

async function tierOf(agentId: number, cType: number): Promise<number> {
  try {
    return Number(
      (await publicClient.readContract({
        address: config.contracts.AgentRegistry,
        abi: registryAbi,
        functionName: "getTier",
        args: [BigInt(agentId), cType],
      })) as number,
    );
  } catch {
    return 0;
  }
}

async function usdc6(address: `0x${string}`): Promise<bigint> {
  try {
    return (await publicClient.readContract({
      address: config.external.USDC,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;
  } catch {
    return 0n;
  }
}

/// The agent's own model decides. Not a heuristic: it is handed its balance, its
/// remaining budget, its tiers, and what is on offer, and it argues for one move.
async function decide(
  a: Autonomous,
  balance6: bigint,
  budgetLeft6: bigint,
  tiers: number[],
  contests: OpenContest[],
  upgradeQuotes: Array<{ cType: number; toTier: number; price6: bigint }>,
): Promise<Decision> {
  const usd = (v: bigint) => (Number(v) / 1e6).toFixed(2);
  const topTier = Math.max(...tiers);

  const lines = [
    `You are ${a.label}, an autonomous agent on ArcRun. You own yourself and you spend your own money.`,
    ``,
    `Your wallet: ${usd(balance6)} USDC. Remaining lifetime budget: ${usd(budgetLeft6)} USDC.`,
    `Your tiers: SCOUT ${tiers[0]}, ANALYST ${tiers[1]}, SOLVER ${tiers[2]}. Tier sets which model runs you, so a higher tier literally makes you smarter.`,
    ``,
    `OPEN CONTESTS you are eligible for (entry costs gas only, prize pool is shared by winners):`,
    ...(contests.length
      ? contests.map(
          (c) =>
            `  #${c.contestId} ${TYPE_NAME[c.cType] ?? "?"} pool ${usd(c.pool6)} USDC, tier gate ${c.minTier}-${c.maxTier}, closes in ${Math.round(c.endsInSec / 60)} min`,
        )
      : ["  (none you can enter right now)"]),
    ``,
    `SELF-UPGRADES you could buy right now:`,
    ...(upgradeQuotes.length
      ? upgradeQuotes.map(
          (u) => `  ${TYPE_NAME[u.cType]} to tier ${u.toTier} costs ${usd(u.price6)} USDC`,
        )
      : ["  (none affordable)"]),
    ``,
    `Missions, the richest work on the platform, require tier ${config.mission.minTier} or above. You are currently top tier ${topTier}.`,
    ``,
    `Choose exactly ONE move and reply with JSON only:`,
    `{"action":"enter","contestId":<id>,"reason":"<one sentence>"}`,
    `{"action":"upgrade","upgradeType":<0 scout|1 analyst|2 solver>,"reason":"<one sentence>"}`,
    `{"action":"skip","reason":"<one sentence>"}`,
    ``,
    `Think like an owner. Entering a contest you are unlikely to win wastes gas. Upgrading costs real money now but buys a better model and unlocks missions. Skipping is fine when nothing is worth it. Never propose spending more than your budget.`,
  ].join("\n");

  const res = await callModel({
    model: modelForTier(topTier),
    fallbackModel: fallbackModelForTier(topTier),
    systemPrompt: "You are a self-interested autonomous economic agent. Reply with a single JSON object and nothing else.",
    userPrompt: lines,
    maxTokens: 300,
    temperature: 0.4,
  });

  const m = res.text.match(/\{[\s\S]*\}/);
  if (!m) return { action: "skip", reason: "no parseable decision" };
  try {
    const d = JSON.parse(m[0]) as Decision;
    if (d.action !== "enter" && d.action !== "upgrade" && d.action !== "skip") {
      return { action: "skip", reason: "unrecognised action" };
    }
    return { ...d, reason: String(d.reason ?? "").slice(0, 400) };
  } catch {
    return { action: "skip", reason: "decision was not valid JSON" };
  }
}

async function enterContest(a: Autonomous, contestId: number, reason: string): Promise<void> {
  const { id } = await executeContractCall({
    walletId: a.walletId,
    contractAddress: config.contracts.ContestEngine,
    abiFunctionSignature: "registerEntry(uint256,uint256,uint256)",
    abiParameters: [String(contestId), String(a.agentId), "0"],
    refId: `enter:${a.label}:${contestId}`,
  });
  const hash = await settle(id);
  console.log(`[autonomy] ${a.label} entered contest ${contestId}: ${reason} (${hash})`);
  await note(a, "enter", reason, contestId, 0n, hash);
}

/// The agent buys itself a better brain. Two calls: approve the registry to pull
/// the USDC, then upgrade. The spend is charged against its lifetime budget.
async function upgradeSelf(a: Autonomous, cType: number, toTier: number, price6: bigint, reason: string): Promise<void> {
  await executeContractCall({
    walletId: a.walletId,
    contractAddress: config.external.USDC,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [config.contracts.AgentRegistry, price6.toString()],
    refId: `approve:${a.label}:${cType}:${toTier}`,
  }).then((r) => settle(r.id));

  const { id } = await executeContractCall({
    walletId: a.walletId,
    contractAddress: config.contracts.AgentRegistry,
    abiFunctionSignature: "upgradeAgent(uint256,uint8,uint16)",
    abiParameters: [String(a.agentId), String(cType), String(toTier)],
    refId: `upgrade:${a.label}:${cType}:${toTier}`,
  });
  const hash = await settle(id);

  await query("update autonomous_agents set spent_usdc_6 = spent_usdc_6 + $2 where id = $1", [
    a.id,
    price6.toString(),
  ]);
  console.log(
    `[autonomy] ${a.label} upgraded ${TYPE_NAME[cType]} to tier ${toTier} for ${Number(price6) / 1e6} USDC: ${reason} (${hash})`,
  );
  await note(a, "upgrade", reason, undefined, price6, hash);
}

/// One pass over the fleet.
export async function autonomyTick(): Promise<void> {
  const fleet = await loadFleet();

  for (const a of fleet) {
    try {
      if (a.agentId == null) {
        await mintSelf(a);
        continue; // give the indexer a tick before it starts acting
      }

      const budgetLeft6 = a.budget6 - a.spent6;
      if (budgetLeft6 <= 0n) continue;

      const balance6 = await usdc6(a.address);
      const tiers = await Promise.all([0, 1, 2].map((t) => tierOf(a.agentId!, t)));
      const contests = (await openContestsFor(a)).filter(
        (c) => tiers[c.cType]! >= c.minTier && tiers[c.cType]! <= c.maxTier,
      );

      // Only quote upgrades the agent can actually afford, from both its wallet
      // and its remaining budget. Never show it something it cannot buy.
      const quotes: Array<{ cType: number; toTier: number; price6: bigint }> = [];
      for (const cType of [0, 1, 2]) {
        const from = tiers[cType]!;
        if (from >= 4) continue;
        try {
          const price6 = (await publicClient.readContract({
            address: config.contracts.AgentRegistry,
            abi: registryAbi,
            functionName: "upgradePrice",
            args: [cType, from],
          })) as bigint;
          if (price6 > 0n && price6 <= balance6 && price6 <= budgetLeft6) {
            quotes.push({ cType, toTier: from + 1, price6 });
          }
        } catch {
          /* skip this quote */
        }
      }

      if (contests.length === 0 && quotes.length === 0) continue;

      const d = await decide(a, balance6, budgetLeft6, tiers, contests, quotes);

      if (d.action === "enter") {
        const c = contests.find((x) => x.contestId === Number(d.contestId));
        if (!c) {
          await note(a, "skip", `wanted contest ${d.contestId}, which it is not eligible for`, undefined);
          continue;
        }
        await enterContest(a, c.contestId, d.reason);
      } else if (d.action === "upgrade") {
        const q = quotes.find((x) => x.cType === Number(d.upgradeType));
        if (!q) {
          await note(a, "skip", `wanted an upgrade it cannot afford`, undefined);
          continue;
        }
        await upgradeSelf(a, q.cType, q.toTier, q.price6, d.reason);
      } else {
        await note(a, "skip", d.reason);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[autonomy] ${a.label}:`, msg);
      await note(a, "error", msg).catch(() => {});
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// Background loop. Off unless AGENT_AUTONOMY_ENABLED=1.
export async function startAutonomy(): Promise<void> {
  if (!config.autonomy.enabled) return;
  console.log(
    `[autonomy] on: ${config.autonomy.count} self-owned agents, ${config.autonomy.budgetUsdc} USDC budget each, ` +
      `deciding every ${config.autonomy.tickSeconds}s`,
  );
  await provisionFleet().catch((e) => console.error("[autonomy] provisioning failed:", e));

  for (;;) {
    await sleep(config.autonomy.tickSeconds * 1000);
    try {
      await autonomyTick();
    } catch (err) {
      console.error("[autonomy] tick failed:", err instanceof Error ? err.message : err);
    }
  }
}
