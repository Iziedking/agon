import { createPublicClient, defineChain, http, webSocket } from "viem";
import { config } from "../config/index.js";

/// Arc testnet as a viem chain. Native currency uses 18 internal decimals
/// (USDC shows 6 to users), per the Arc docs network configuration.
export const arcTestnet = defineChain({
  id: config.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [config.rpcHttp], webSocket: [config.rpcWs] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

/// HTTP client for reads and log polling.
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(config.rpcHttp, { retryCount: 3, timeout: 15_000 }),
});

/// WebSocket client for live event subscriptions (eth_subscribe is WS-only on Arc).
export const wsClient = createPublicClient({
  chain: arcTestnet,
  transport: webSocket(config.rpcWs, { retryCount: 3 }),
});
