export type BnbChainId = 56 | 97;

export interface BnbNetwork {
  id: BnbChainId;
  name: string;
  label: string;
  shortLabel: string;
  symbol: string;
  explorer: string;
  rpc: string;
  nativeToken: string;
  description: string;
  isMainnet: boolean;
}

export const BNB_MAINNET_ID: BnbChainId = 56;
export const BNB_TESTNET_ID: BnbChainId = 97;

export const BNB_CHAINS: readonly BnbNetwork[] = [
  {
    id: BNB_MAINNET_ID,
    name: "BNB Smart Chain Mainnet",
    label: "BSC Mainnet",
    shortLabel: "Mainnet",
    symbol: "BNB",
    explorer: "https://bscscan.com",
    rpc: process.env.NEXT_PUBLIC_BNB_MAINNET_RPC_URL ?? "https://bsc-dataseed.binance.org",
    nativeToken: "BNB",
    description: "Production BNB context. Keep writes gated until the testnet proof is complete.",
    isMainnet: true,
  },
  {
    id: BNB_TESTNET_ID,
    name: "BNB Smart Chain Testnet",
    label: "BSC Testnet",
    shortLabel: "Testnet",
    symbol: "tBNB",
    explorer: "https://testnet.bscscan.com",
    rpc: process.env.NEXT_PUBLIC_BNB_TESTNET_RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com",
    nativeToken: "tBNB",
    description: "Safe rehearsal network for all public smoke tests and dry-run flow.",
    isMainnet: false,
  },
] as const;

export const DEFAULT_BNB_CHAIN = BNB_MAINNET_ID;

export function resolveBnbChain(value: unknown): BnbChainId {
  if (value === BNB_MAINNET_ID || value === "56" || value === "bnb-mainnet") return BNB_MAINNET_ID;
  if (value === BNB_TESTNET_ID || value === "97" || value === "bnb-testnet") return BNB_TESTNET_ID;
  return DEFAULT_BNB_CHAIN;
}

export function getBnbNetwork(chainId: number): BnbNetwork {
  const numericChainId = Number(chainId);
  const found = BNB_CHAINS.find((network) => network.id === numericChainId);
  if (!found) {
    return BNB_CHAINS.find((network) => network.id === DEFAULT_BNB_CHAIN) ?? BNB_CHAINS[0];
  }
  return found;
}

export function isSupportedBnbChain(chainId: number): chainId is BnbChainId {
  return chainId === BNB_MAINNET_ID || chainId === BNB_TESTNET_ID;
}
