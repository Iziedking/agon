import { fallback, http } from "wagmi";
import {
  arbitrumSepolia,
  arcTestnet,
  avalancheFuji,
  baseSepolia,
  optimismSepolia,
  polygonAmoy,
  sepolia,
  unichainSepolia,
} from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

/// wagmi config, built through RainbowKit's `getDefaultConfig` so the wallet
/// picker is populated with the full branded list (MetaMask, Rabby, Coinbase,
/// Rainbow, WalletConnect + the mobile QR path), not just whichever EIP-6963
/// extension happens to be installed. A plain `injected()` connector produced a
/// one-row modal; this is the rich picker.
///
/// getDefaultConfig is client-only, so this module must NOT be imported into a
/// server component (e.g. for cookieToInitialState) — it throws there. With
/// ssr:true it persists the connection in cookieStorage, so a returning user
/// reconnects from cookies on the client. The session detector in useAuth waits
/// for that reconnect (the walletSettled gate) before judging the wallet
/// missing, which is what keeps a full-page navigation from signing the user
/// out mid-reconnect.
///
/// WalletConnect needs a project id from cloud.reown.com
/// (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID). getDefaultConfig THROWS on an empty
/// id, which would fail the whole production build if the env var is missing,
/// so we fall back to a placeholder: the site still builds and the injected /
/// Coinbase paths still work; only the WalletConnect/QR option is dead until a
/// real id is set. Set the env var on Vercel to enable WalletConnect.
///
/// arcTestnet is the home chain for everything ArcRun-native (contests, agents,
/// settlement). The other testnets are registered so /bridge can switch the
/// wallet to a source chain and bridge USDC into Arc. Each uses its public RPC.
///
/// The Arc transport is the hot path (every wallet read — balances, contract
/// reads — goes through it), and the public Arc RPC rate-limits bursts. So it gets
/// JSON-RPC batching (coalesce concurrent reads into one request), a retry for the
/// 429/5xx, and dedicated endpoint(s) via NEXT_PUBLIC_ARC_RPC_HTTP (comma-separated,
/// primary first). When set, the transport is a `fallback([...])` that tries the
/// dedicated endpoint(s) then the public RPC, so one endpoint failing never breaks
/// wallet reads. The bridge source chains stay on their bare public RPCs — they're
/// touched only during an occasional bridge, not on every page.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "arcrun_walletconnect_unset";
const arcDedicatedRpc = (process.env.NEXT_PUBLIC_ARC_RPC_HTTP || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
const ARC_RPC_OPTS = { batch: true, retryCount: 3 } as const;
const arcTransport = arcDedicatedRpc.length
  ? fallback([...arcDedicatedRpc.map((u) => http(u, ARC_RPC_OPTS)), http(undefined, ARC_RPC_OPTS)])
  : http(undefined, ARC_RPC_OPTS);

export const config = getDefaultConfig({
  appName: "ArcRun",
  projectId,
  chains: [
    arcTestnet,
    sepolia,
    baseSepolia,
    arbitrumSepolia,
    optimismSepolia,
    polygonAmoy,
    avalancheFuji,
    unichainSepolia,
  ],
  transports: {
    [arcTestnet.id]: arcTransport,
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
    [optimismSepolia.id]: http(),
    [polygonAmoy.id]: http(),
    [avalancheFuji.id]: http(),
    [unichainSepolia.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
