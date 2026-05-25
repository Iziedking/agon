import "dotenv/config";
import { parseAbi } from "viem";

import { publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { deriveHotWallet } from "../runners/scout.js";
import { query } from "../db/pool.js";
import { fundHotWallets } from "./contestOps.js";

/// Lists each Scout agent's derived hot wallet (and balance), and optionally
/// funds them with USDC from the coordinator wallet. USDC on Arc is one balance
/// with two interfaces, so a single transfer covers both gas and transfers.
///
/// You usually do not need this: the coordinator's autopilot funds Scout
/// entrants automatically before each Scout contest settles. Use this only to
/// inspect balances or top wallets up by hand.
///
/// Run: npm run fund-scouts
/// Env: AGENT_IDS=1,2,3  or  CONTEST_ID=<id>   FUND_USDC=1   LIST_ONLY=1

const usdcAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

async function resolveAgentIds(): Promise<number[]> {
  if (process.env.AGENT_IDS) {
    return process.env.AGENT_IDS.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  }
  if (process.env.CONTEST_ID) {
    const { rows } = await query<{ agent_id: string }>(
      "select agent_id from entries where contest_id = $1 order by agent_id",
      [Number(process.env.CONTEST_ID)],
    );
    return rows.map((r) => Number(r.agent_id));
  }
  throw new Error("set AGENT_IDS=1,2,3 or CONTEST_ID=<id>");
}

async function balanceOf(address: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({ address: config.external.USDC, abi: usdcAbi, functionName: "balanceOf", args: [address] });
}

async function main() {
  if (!config.scout.masterMnemonic) throw new Error("SCOUT_MASTER_MNEMONIC required to derive hot wallets");

  const ids = await resolveAgentIds();
  if (ids.length === 0) {
    console.log("no agents to fund");
    return;
  }

  // Always print each hot wallet and its balance first.
  for (const id of ids) {
    const w = deriveHotWallet(id);
    const bal = await balanceOf(w.address);
    console.log(`agent ${id}: ${w.address}  balance ${(Number(bal) / 1e6).toFixed(2)} USDC`);
  }

  const listOnly = process.env.LIST_ONLY === "1" || !config.coordinator.privateKey;
  if (listOnly) {
    console.log("\nlist-only. fund these addresses from faucet.circle.com, or set COORDINATOR_PRIVATE_KEY to auto-fund.");
    return;
  }

  const fundUsdc = Number(process.env.FUND_USDC ?? "1");
  console.log(`\nfunding ${ids.length} wallet(s) up to ${fundUsdc} USDC each...`);
  await fundHotWallets(ids, fundUsdc);
  console.log("done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
