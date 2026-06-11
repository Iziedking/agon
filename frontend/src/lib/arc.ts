import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";

/// Re-export viem's built-in Arc testnet chain. viem ships `arcTestnet`
/// natively (chain id 5042002, RPC, explorer, 18-dec USDC native gas), so a
/// custom `defineChain` is never required.
export { arcTestnet };

export const EXPLORER = "https://testnet.arcscan.app";

/// Arc system contracts: the ERC-8004 IdentityRegistry mints the ERC-721 NFT
/// that backs every ArcRun agent. The token id is stored on the agent's row in
/// AgentRegistry as `erc8004TokenId` and is what other Arc contracts read for
/// trustless agent identity.
export const ERC8004_IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;

/// Arcscan token page for a given ERC-721 token. Most explorers accept the
/// `?a=tokenId` parameter on the contract page.
export function nftLink(tokenId: bigint | number | string): string {
  return `${EXPLORER}/token/${ERC8004_IDENTITY_REGISTRY}?a=${String(tokenId)}`;
}

/// Native USDC on Arc (6 decimals as an ERC-20). Used for agent upgrades.
export const USDC = "0x3600000000000000000000000000000000000000" as const;

/// Read-only client for fetching on-chain state (no wallet needed).
///
/// `batch.multicall` is the load-bearing line: list pages read every contest
/// and challenge ever created (2 eth_calls each, hundreds of items), and
/// firing those as individual RPC requests rate-limits the public Arc RPC
/// (pages crawled and throttled reads silently dropped cards from the grid).
/// With batching on, viem aggregates all reads scheduled in the same tick
/// through Multicall3 (deployed on Arc at the canonical address), so a full
/// list load is a handful of RPC round-trips instead of 600.
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
  batch: { multicall: { wait: 16, batchSize: 4_096 } },
});

/// Deployed ArcRun contracts on Arc testnet. Public addresses; the canonical
/// record is contracts/deployments/arc-testnet.json.
export const CONTRACTS = {
  ContestEngine: "0xCeFD67616fac0A4eeb244C7EDf6cc63E3962Afba",
  ChallengeArena: "0xa3658A8001182bB0556B93193B00A1272F7D3322",
  AgentRegistry: "0x99306f3f4C1608915f07eDE24F5e6515F6eeE281",
  PrizeEscrow: "0x9A81C86aA4E548EC322889cdE7E489fBEb0a215F",
  SyndicateFactory: "0x611E5b5ccECe86bB092Bd363F065abE0D3b739B3",
  PointsLedger: "0xd1b822137391f40bc70c8BC1EF5690fD62Fe7AD5",
} as const;
