import { http } from "wagmi";
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
/// picker is populated out of the box: injected/MetaMask, Coinbase Wallet,
/// Rainbow, and WalletConnect (which adds the QR path for any mobile wallet).
/// Previously this registered only `injected()`, so "connect wallet" silently
/// grabbed whichever extension was active and a user with several wallets had
/// no way to choose. The picker fixes that.
///
/// WalletConnect needs a project id from cloud.reown.com. Set
/// NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID; without it the injected and Coinbase
/// paths still work, but the WalletConnect/QR option is disabled.
///
/// arcTestnet stays the home chain for everything ArcRun-native (contests,
/// agents, settlement). The other testnets are registered so the /bridge page
/// can switch the wallet to a source chain and bridge USDC into Arc. Each chain
/// uses its default public RPC.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

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
    [arcTestnet.id]: http(),
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
