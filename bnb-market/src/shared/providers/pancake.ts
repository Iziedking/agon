import { createHash } from "node:crypto";
import { parseAbi, zeroAddress } from "viem";
import { checkedClient } from "../server/network.ts";
import { HttpError } from "../server/http.ts";
import { analyseRange, meanTick, parseLpInput, LP_AGENT_VERSION, ORACLE_WINDOW_SECONDS, type LpInput } from "./lp-core.ts";

// viem 2.50.4. Sources inspected 2026-09-04:
// https://developer.pancakeswap.finance/contracts/v3/addresses
// pancake-v3-contracts/main/projects/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol
// projects/v3-core/contracts/interfaces/{IPancakeV3Factory,pool/IPancakeV3PoolState,pool/IPancakeV3PoolActions}.sol
// Testnet manager differs from Mainnet. Never accept caller-supplied contracts.
export const PANCAKE_TESTNET = {
  manager: "0x427bF5b37357632377eCbEC9de3626C71A5396c1",
  factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
} as const;
const MANAGER = parseAbi([
  "function factory() view returns(address)", "function ownerOf(uint256) view returns(address)",
  "function positions(uint256) view returns(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)",
]);
const FACTORY = parseAbi(["function getPool(address,address,uint24) view returns(address)"]);
const POOL = parseAbi([
  "function factory() view returns(address)", "function token0() view returns(address)", "function token1() view returns(address)",
  "function fee() view returns(uint24)", "function tickSpacing() view returns(int24)", "function liquidity() view returns(uint128)",
  "function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint32,bool)",
  "function observe(uint32[]) view returns(int56[],uint160[])",
]);
export function requireLpTestnet(chain: number) {
  if (chain !== 97) throw new HttpError(409, "AGON LP Guardian is available on BNB Testnet only. Switch networks to run it.");
}
export async function inspectLpPosition(chain: number, raw: LpInput) {
  requireLpTestnet(chain); const input = parseLpInput(raw);
  const client = await checkedClient(97);
  const block = await client.getBlock(); const blockNumber = block.number;
  if (blockNumber === null || !block.hash || Math.abs(Math.floor(Date.now() / 1000) - Number(block.timestamp)) > 120) throw new HttpError(503, "The BNB source block is stale. Try again later.");
  const [managerCode, factoryCode, factory] = await Promise.all([
    client.getCode({ address: PANCAKE_TESTNET.manager, blockNumber }), client.getCode({ address: PANCAKE_TESTNET.factory, blockNumber }),
    client.readContract({ address: PANCAKE_TESTNET.manager, abi: MANAGER, functionName: "factory", blockNumber }),
  ]);
  if (!managerCode || managerCode === "0x" || !factoryCode || factoryCode === "0x" || factory.toLowerCase() !== PANCAKE_TESTNET.factory.toLowerCase()) throw new HttpError(503, "PancakeSwap deployment verification failed.");
  const [owner, position] = await Promise.all([
    client.readContract({ address: PANCAKE_TESTNET.manager, abi: MANAGER, functionName: "ownerOf", args: [BigInt(input.positionId)], blockNumber }),
    client.readContract({ address: PANCAKE_TESTNET.manager, abi: MANAGER, functionName: "positions", args: [BigInt(input.positionId)], blockNumber }),
  ]).catch(() => { throw new HttpError(422, "The position could not be read on BNB Testnet. Check its NFT ID, then retry."); });
  const [, , token0, token1, fee, tickLower, tickUpper, liquidity, , , owed0, owed1] = position;
  const pool = await client.readContract({ address: PANCAKE_TESTNET.factory, abi: FACTORY, functionName: "getPool", args: [token0, token1, fee], blockNumber });
  if (pool === zeroAddress) throw new HttpError(422, "No PancakeSwap pool matches this position.");
  const poolRead = { address: pool, abi: POOL, blockNumber };
  const [poolCode, poolFactory, poolToken0, poolToken1, poolFee, tickSpacing, poolLiquidity, slot] = await Promise.all([
    client.getCode({ address: pool, blockNumber }),
    client.readContract({ ...poolRead, functionName: "factory" }), client.readContract({ ...poolRead, functionName: "token0" }),
    client.readContract({ ...poolRead, functionName: "token1" }), client.readContract({ ...poolRead, functionName: "fee" }),
    client.readContract({ ...poolRead, functionName: "tickSpacing" }), client.readContract({ ...poolRead, functionName: "liquidity" }),
    client.readContract({ ...poolRead, functionName: "slot0" }),
  ]);
  if (!poolCode || poolCode === "0x" || poolFactory.toLowerCase() !== factory.toLowerCase() || poolToken0.toLowerCase() !== token0.toLowerCase() || poolToken1.toLowerCase() !== token1.toLowerCase() || poolFee !== fee) throw new HttpError(503, "Pool identity does not match the position.");
  if (slot[0] === 0n || !slot[6]) throw new HttpError(422, "The pool is uninitialized or locked. Try again later.");
  let observations: readonly bigint[] | null = null;
  try {
    const result = await client.readContract({ ...poolRead, functionName: "observe", args: [[ORACLE_WINDOW_SECONDS, 0]] });
    if (result[0].length === 2) observations = result[0];
  } catch { /* Oracle history is optional evidence, never a spot-price fallback. */ }
  const twapTick = observations ? meanTick(observations[0], observations[1], ORACLE_WINDOW_SECONDS) : null;
  const state = { tick: slot[1], tickLower, tickUpper, tickSpacing, liquidity: String(liquidity), poolLiquidity: String(poolLiquidity), twapTick };
  const decision = analyseRange(input, state);
  if ((await client.getBlock({ blockNumber })).hash !== block.hash) throw new HttpError(503, "The source block changed during the check. Run a fresh analysis.");
  const report = {
    version: LP_AGENT_VERSION, operator: "AGON", chainId: 97 as const, mode: "read_only" as const,
    input, decision, state,
    evidence: { blockNumber: String(blockNumber), blockHash: block.hash, blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      manager: PANCAKE_TESTNET.manager, factory, pool, owner, token0, token1, fee, sqrtPriceX96: String(slot[0]),
      oracleWindowSeconds: ORACLE_WINDOW_SECONDS, tickCumulatives: observations?.map(String) ?? null,
      lastAccountedTokensOwed: { token0: String(owed0), token1: String(owed1) },
      blockUrl: `https://testnet.bscscan.com/block/${blockNumber}`, positionUrl: `https://testnet.bscscan.com/token/${PANCAKE_TESTNET.manager}?a=${input.positionId}` },
    limitations: ["Analysis only; no liquidity moved, wallet authority granted, or payment made.",
      "The rule does not estimate profitability, fees, slippage or optimal yield. Spot and TWAP can both be manipulated.",
      "Tokens owed are last-accounted raw amounts, not total current fees or dollar values.",
      "This is a block snapshot, not continuous monitoring or a finalized settlement receipt."],
  };
  const reportJson = JSON.stringify(report);
  return { report, reportJson, reportHash: `sha256:${createHash("sha256").update(reportJson).digest("hex")}` };
}
export type LpReport = Awaited<ReturnType<typeof inspectLpPosition>>["report"];
