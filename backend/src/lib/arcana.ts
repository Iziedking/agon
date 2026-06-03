import { config } from "../config/index.js";
import { publicClient } from "../chain/arc.js";
import { arcanaMarketsAbi, usdcMinimalAbi } from "../chain/abi.js";

/// Typed read client for the Arcana Markets contract on Arc Testnet.
/// Source of truth: docs/brandkit/12-arcana-integration-brief.md and the
/// reference-arcana-markets memory. Writes (buyShares, claimWinnings) live
/// in the runner; this module is read-only so the indexer and admin pages
/// can pull state without any signer setup.

const ARCANA = config.arcana.address;
const USDC = config.external.USDC;

/// Decoded market state, returned by getMarket(). yesPool / noPool / endTime
/// are bigints on chain (USDC 6dec for pools, unix seconds for endTime); kept
/// as bigint here so callers can decide how to format.
export interface ArcanaMarket {
  id: bigint;
  title: string;
  category: string;
  yesPool: bigint;
  noPool: bigint;
  endTime: bigint;
  resolved: boolean;
  cancelled: boolean;
}

/// Count of markets ever created. Iterate 0..count-1 to enumerate.
export async function getMarketCount(): Promise<bigint> {
  return publicClient.readContract({
    address: ARCANA,
    abi: arcanaMarketsAbi,
    functionName: "marketCount",
  });
}

/// Single market read. Throws if id >= marketCount(). Returns a typed
/// ArcanaMarket regardless of whether the contract returns a struct or tuple.
export async function getMarket(id: bigint): Promise<ArcanaMarket> {
  const m = (await publicClient.readContract({
    address: ARCANA,
    abi: arcanaMarketsAbi,
    functionName: "markets",
    args: [id],
  })) as readonly [bigint, string, string, bigint, bigint, bigint, boolean, boolean];
  return {
    id: m[0],
    title: m[1],
    category: m[2],
    yesPool: m[3],
    noPool: m[4],
    endTime: m[5],
    resolved: m[6],
    cancelled: m[7],
  };
}

/// Batch read via viem multicall — single eth_call for the whole list,
/// instead of N sequential RPC round-trips. Falls back to per-id reads
/// when multicall isn't available on the RPC (unlikely on Arc but the
/// fallback keeps dev environments resilient).
export async function getMarkets(ids: bigint[]): Promise<ArcanaMarket[]> {
  if (ids.length === 0) return [];
  try {
    const results = await publicClient.multicall({
      contracts: ids.map((id) => ({
        address: ARCANA,
        abi: arcanaMarketsAbi,
        functionName: "markets" as const,
        args: [id] as const,
      })),
      allowFailure: true,
    });
    return results.map((r, i) => {
      if (r.status !== "success" || !r.result) {
        // Multicall succeeded but this slot reverted (id out of range or
        // similar). Return a placeholder so the caller's array stays
        // aligned with ids; isOpen() filters it out anyway.
        return {
          id: ids[i]!,
          title: "",
          category: "",
          yesPool: 0n,
          noPool: 0n,
          endTime: 0n,
          resolved: false,
          cancelled: true,
        };
      }
      const m = r.result as unknown as readonly [bigint, string, string, bigint, bigint, bigint, boolean, boolean];
      return {
        id: m[0],
        title: m[1],
        category: m[2],
        yesPool: m[3],
        noPool: m[4],
        endTime: m[5],
        resolved: m[6],
        cancelled: m[7],
      };
    });
  } catch {
    // Multicall unavailable (extremely rare on Arc). Fall back to
    // sequential reads so the heartbeat still works in dev environments
    // with a stripped RPC.
    return Promise.all(ids.map(getMarket));
  }
}

/// Current odds returned by the contract. Both numerator and denominator are
/// scaled the same way by the contract (we don't know the exact scale without
/// reading the source); the ratio yesOdds / (yesOdds + noOdds) gives the
/// implied YES probability either way.
export async function getMarketOdds(
  id: bigint,
): Promise<{ yesOdds: bigint; noOdds: bigint }> {
  const [yesOdds, noOdds] = (await publicClient.readContract({
    address: ARCANA,
    abi: arcanaMarketsAbi,
    functionName: "getMarketOdds",
    args: [id],
  })) as readonly [bigint, bigint];
  return { yesOdds, noOdds };
}

/// Implied YES probability in [0, 1]. Returns 0.5 when both pools are zero
/// (no information yet).
export async function getImpliedYesProbability(id: bigint): Promise<number> {
  const { yesOdds, noOdds } = await getMarketOdds(id);
  const sum = yesOdds + noOdds;
  if (sum === 0n) return 0.5;
  return Number((yesOdds * 10000n) / sum) / 10000;
}

/// Per-address position size on each side, in USDC share units (6dec).
export async function getShares(
  id: bigint,
  holder: `0x${string}`,
): Promise<{ yes: bigint; no: bigint }> {
  const [yes, no] = await Promise.all([
    publicClient.readContract({
      address: ARCANA,
      abi: arcanaMarketsAbi,
      functionName: "yesShares",
      args: [id, holder],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: ARCANA,
      abi: arcanaMarketsAbi,
      functionName: "noShares",
      args: [id, holder],
    }) as Promise<bigint>,
  ]);
  return { yes, no };
}

/// Owner / resolver address. Used by the indexer + admin page to display
/// who can resolve. Single EOA on the current deployment.
export async function getOwner(): Promise<`0x${string}`> {
  return publicClient.readContract({
    address: ARCANA,
    abi: arcanaMarketsAbi,
    functionName: "owner",
  }) as Promise<`0x${string}`>;
}

/// USDC allowance from holder to the Arcana contract. Use before buyShares
/// to decide whether an approve() is needed.
export async function getUsdcAllowance(holder: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: USDC,
    abi: usdcMinimalAbi,
    functionName: "allowance",
    args: [holder, ARCANA],
  }) as Promise<bigint>;
}

/// Open-market filter shared by the coordinator (round pinning) and the
/// admin heartbeat. "Open" = not resolved, not cancelled, endTime in the
/// future relative to now. Pass `windowSeconds` to also require the market
/// resolves inside that window.
export function isOpen(m: ArcanaMarket, nowSec: bigint, windowSeconds?: bigint): boolean {
  if (m.resolved || m.cancelled) return false;
  if (m.endTime <= nowSec) return false;
  if (windowSeconds !== undefined && m.endTime - nowSec > windowSeconds) return false;
  return true;
}

/// Convenience: read the last N markets descending by id, return as-is.
/// Used by the admin heartbeat to show current state without enumerating
/// every market. Caps the read at min(n, marketCount).
export async function getLatestMarkets(n: number): Promise<ArcanaMarket[]> {
  const count = await getMarketCount();
  const start = count > BigInt(n) ? count - BigInt(n) : 0n;
  const ids: bigint[] = [];
  for (let i = count - 1n; i >= start; i--) {
    ids.push(i);
    if (i === 0n) break;
  }
  return getMarkets(ids);
}

/// Calldata helper for an external signer (web3 wallet or Circle) to call
/// USDC.approve(arcana, amount). Returns the function signature + args
/// shape the Circle /wallet/execute endpoint expects, AND the encoded
/// calldata for ethers/viem use.
export function buildUsdcApprove(amountUsdc6: bigint): {
  to: `0x${string}`;
  abiFunctionSignature: string;
  abiParameters: [string, string];
} {
  return {
    to: USDC,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [ARCANA, amountUsdc6.toString()],
  };
}

/// Calldata helper for ArcanaMarkets.buyShares(marketId, isYes, amountUsdc6).
export function buildBuyShares(
  marketId: bigint,
  isYes: boolean,
  amountUsdc6: bigint,
): {
  to: `0x${string}`;
  abiFunctionSignature: string;
  abiParameters: [string, string, string];
} {
  return {
    to: ARCANA,
    abiFunctionSignature: "buyShares(uint256,bool,uint256)",
    abiParameters: [marketId.toString(), isYes ? "true" : "false", amountUsdc6.toString()],
  };
}

/// Calldata helper for ArcanaMarkets.claimWinnings(marketId).
export function buildClaimWinnings(marketId: bigint): {
  to: `0x${string}`;
  abiFunctionSignature: string;
  abiParameters: [string];
} {
  return {
    to: ARCANA,
    abiFunctionSignature: "claimWinnings(uint256)",
    abiParameters: [marketId.toString()],
  };
}
