import { createPublicClient, http, webSocket } from "viem";
import { arcTestnet } from "viem/chains";
import { config } from "../config/index.js";

/// Re-export viem's built-in Arc testnet (chain id 5042002). Per the
/// `circle:use-arc` skill, a custom `defineChain` is never required since viem
/// ships the chain natively. RPC URLs come from env via `config.rpcHttp` and
/// `config.rpcWs`, passed explicitly to the transports below so a paid or
/// regional RPC can override the canonical one without redefining the chain.
if (config.chainId !== arcTestnet.id) {
  console.warn(
    `chain mismatch: config.chainId=${config.chainId} but viem's arcTestnet.id=${arcTestnet.id}. ` +
      "Reads/writes will still target arcTestnet; update CHAIN_ID in .env to align.",
  );
}
export { arcTestnet };

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
