import { cookieStorage, createConfig, createStorage, http } from "wagmi";
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
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

/// wagmi config. Built with plain `createConfig` (NOT RainbowKit's
/// getDefaultConfig) on purpose: getDefaultConfig is a client-only function, so
/// it can't be imported into the server-rendered root layout where
/// cookieToInitialState needs the config. createConfig is isomorphic, so the
/// layout can hydrate the connection from cookies and a full page reload knows
/// the wallet up front instead of cold-reconnecting.
///
/// The connector set still gives RainbowKit a full picker: `injected()` plus
/// wagmi's default EIP-6963 discovery surfaces every installed wallet
/// (MetaMask, Rabby, Coinbase extension, ...) as its own entry, and we add the
/// Coinbase and WalletConnect connectors so the in-app Coinbase wallet and the
/// mobile QR path show up too. Previously this registered only `injected()`,
/// so "connect wallet" silently grabbed whichever extension was active.
///
/// WalletConnect needs a project id from cloud.reown.com
/// (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID). It's added only when the id is set;
/// without it the injected and Coinbase paths still work and the build/runtime
/// don't throw on an empty id.
///
/// `cookieStorage` is load-bearing: the connection state lives in a cookie the
/// server can read, which is what makes cookieToInitialState work. With the
/// default localStorage the server would see nothing and reconnect would stay a
/// client-side race.
///
/// arcTestnet is the home chain for everything ArcRun-native (contests, agents,
/// settlement). The other testnets are registered so /bridge can switch the
/// wallet to a source chain and bridge USDC into Arc. Each uses its public RPC.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const config = createConfig({
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
  connectors: [
    injected(),
    coinbaseWallet({ appName: "ArcRun" }),
    ...(projectId ? [walletConnect({ projectId })] : []),
  ],
  storage: createStorage({ storage: cookieStorage }),
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
