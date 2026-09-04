import { createPublicClient, fallback, http, parseAbi, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { getAddress as sdkAddresses } from "@bnbagent/sdk/networks";
import type { BnbChain } from "../types.ts";

// @bnbagent/sdk 0.5.5, dist/chunk-TKWQT3DN.js (ContractInterface), and
// getErc8004Config; inspected 2026-09-04. Keep ID values as bigint: SDK's
// number agentId type can lose precision. Global SDK RPC overrides are not used.
export const IDENTITY_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
]);
export const BNB_REGISTRIES: Record<BnbChain, Address> = {
  56: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  97: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
};
export function networkConfig(chainId: BnbChain) {
  const chain = chainId === 97 ? bscTestnet : bsc;
  const configured = process.env[`BNB_${chainId}_RPC_URL`]?.trim();
  return { chain, registry: BNB_REGISTRIES[chainId], contracts: sdkAddresses(chainId),
    rpcUrls: configured ? [configured] : [...chain.rpcUrls.default.http],
    explorer: chain.blockExplorers.default.url };
}
export function bnbClient(chainId: BnbChain) {
  const config = networkConfig(chainId);
  return createPublicClient({ chain: config.chain,
    transport: fallback(config.rpcUrls.map((url) => http(url, { timeout: 8_000, retryCount: 1 })), { retryCount: 0 }) });
}
export async function checkedClient(chainId: BnbChain) {
  const client = bnbClient(chainId);
  if (await client.getChainId() !== chainId) throw new Error("The BNB RPC returned a different network. Try again later.");
  return client;
}
