import {
  arbitrumSepolia,
  arcTestnet,
  avalancheFuji,
  baseSepolia,
  optimismSepolia,
  polygonAmoy,
  sepolia,
  unichainSepolia,
} from "viem/chains";

/// Bridge UI metadata. App Kit identifies chains by string names
/// (e.g. "Arc_Testnet", "Base_Sepolia") that don't match viem's numeric
/// chain IDs, so we keep a lookup table here. Verified against
/// docs.arc.network/app-kit/references/supported-blockchains testnet list.
///
/// Add a chain here, register it in wagmi.ts, and the picker shows it.

export interface BridgeChain {
  /// wagmi/viem chain id
  id: number;
  /// App Kit chain name (string, used in kit.bridge({chain: <this>}))
  appKitChain: string;
  /// Display label for the picker
  label: string;
  /// Short code shown in the chip ("BASE", "ETH", ...)
  code: string;
  /// USDC contract on this chain (6 decimals). Used by the picker to show
  /// the user's USDC balance pre-bridge. Pulled from Circle's USDC
  /// contract addresses doc.
  usdcAddress: `0x${string}`;
  /// Block explorer URL prefix for transaction links during the bridge flow.
  explorer: string;
  /// Chain icon. llamao.fi's icon CDN is the same source chainlist.org uses,
  /// so the icons match what users see across the ecosystem. Undefined when
  /// the chain isn't on llamao yet (Arc Testnet) — the picker falls back to
  /// a brand-color tile.
  iconUrl?: string;
}

const ICON_BASE = "https://icons.llamao.fi/icons/chains/rsz_";

export const BRIDGE_CHAINS: BridgeChain[] = [
  {
    id: arcTestnet.id,
    appKitChain: "Arc_Testnet",
    label: "Arc Testnet",
    code: "ARC",
    usdcAddress: "0x3600000000000000000000000000000000000000",
    explorer: "https://testnet.arcscan.app",
    // Arc isn't on the llamao CDN yet; we self-host the brand mark in /public.
    iconUrl: "/brand/arc.png",
  },
  {
    id: sepolia.id,
    appKitChain: "Ethereum_Sepolia",
    label: "Ethereum Sepolia",
    code: "ETH",
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    explorer: "https://sepolia.etherscan.io",
    iconUrl: `${ICON_BASE}ethereum.jpg`,
  },
  {
    id: baseSepolia.id,
    appKitChain: "Base_Sepolia",
    label: "Base Sepolia",
    code: "BASE",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorer: "https://sepolia.basescan.org",
    iconUrl: `${ICON_BASE}base.jpg`,
  },
  {
    id: arbitrumSepolia.id,
    appKitChain: "Arbitrum_Sepolia",
    label: "Arbitrum Sepolia",
    code: "ARB",
    usdcAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    explorer: "https://sepolia.arbiscan.io",
    iconUrl: `${ICON_BASE}arbitrum.jpg`,
  },
  {
    id: optimismSepolia.id,
    appKitChain: "OP_Sepolia",
    label: "OP Sepolia",
    code: "OP",
    usdcAddress: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    explorer: "https://sepolia-optimism.etherscan.io",
    iconUrl: `${ICON_BASE}optimism.jpg`,
  },
  {
    id: polygonAmoy.id,
    appKitChain: "Polygon_Amoy_Testnet",
    label: "Polygon Amoy",
    code: "MATIC",
    usdcAddress: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    explorer: "https://amoy.polygonscan.com",
    iconUrl: `${ICON_BASE}polygon.jpg`,
  },
  {
    id: avalancheFuji.id,
    appKitChain: "Avalanche_Fuji",
    label: "Avalanche Fuji",
    code: "AVAX",
    usdcAddress: "0x5425890298aed601595a70AB815c96711a31Bc65",
    explorer: "https://testnet.snowtrace.io",
    iconUrl: `${ICON_BASE}avalanche.jpg`,
  },
  {
    id: unichainSepolia.id,
    appKitChain: "Unichain_Sepolia",
    label: "Unichain Sepolia",
    code: "UNI",
    usdcAddress: "0x31d0220469e10c4E71834a79b1f276d740d3768F",
    explorer: "https://sepolia.uniscan.xyz",
    iconUrl: `${ICON_BASE}unichain.jpg`,
  },
];

export function bridgeChainById(id: number | undefined): BridgeChain | undefined {
  if (!id) return undefined;
  return BRIDGE_CHAINS.find((c) => c.id === id);
}

export function bridgeChainByAppKit(name: string): BridgeChain | undefined {
  return BRIDGE_CHAINS.find((c) => c.appKitChain === name);
}

/// CCTPv2 out-of-Arc bridges must exceed the protocol max fee (~1.4 USDC at
/// time of writing per docs). Source the live number from Circle when this
/// becomes a UX gripe; for now we hard-code a conservative floor.
export const ARC_OUTBOUND_MIN_USDC = 2;

/// Bridge step names emitted by the App Kit SDK. Mirrored here so the UI
/// can build a step strip without depending on the SDK being installed at
/// type-check time.
export const BRIDGE_STEPS = [
  { name: "approve", label: "APPROVE" },
  { name: "burn", label: "BURN" },
  { name: "fetchAttestation", label: "ATTEST" },
  { name: "mint", label: "MINT" },
] as const;

export type BridgeStepName = (typeof BRIDGE_STEPS)[number]["name"];

export interface BridgeStepProgress {
  name: BridgeStepName;
  state: "idle" | "pending" | "success" | "error";
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}
