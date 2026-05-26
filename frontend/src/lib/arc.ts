import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";

/// Re-export viem's built-in Arc testnet chain. Per the `circle:use-arc` skill,
/// viem ships `arcTestnet` natively (chain id 5042002, RPC, explorer, 18-dec
/// USDC native gas), so a custom `defineChain` is never required.
export { arcTestnet };

export const EXPLORER = "https://testnet.arcscan.app";

/// Native USDC on Arc (6 decimals as an ERC-20). Used for agent upgrades.
export const USDC = "0x3600000000000000000000000000000000000000" as const;

/// Read-only client for fetching on-chain state (no wallet needed).
export const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

/// Deployed ArcRun contracts on Arc testnet. Public addresses; the canonical
/// record is contracts/deployments/arc-testnet.json.
export const CONTRACTS = {
  ContestEngine: "0x818B8EE65a059512C689Ddd557bd0d20E0c91B16",
  ChallengeArena: "0xBcfdb3b48AD304D419bf7484a2B22B3e9A1bAbfC",
  AgentRegistry: "0x08D2736275d6243759578510a095F50f09f8aB5C",
  PrizeEscrow: "0xc6E4b4F9d42B723F20DDFB640e5604A0e16E387E",
  SyndicateFactory: "0x31EDEcf4d6258ae9182eBda7C0FdF693E4754772",
  PointsLedger: "0x4e6f9E7Cd4B481AbC99548F052582AaCCFc2f38C",
} as const;
