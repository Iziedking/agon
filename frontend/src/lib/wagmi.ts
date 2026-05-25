import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet } from "./arc";

/// wagmi config for Arc testnet. Uses the injected connector (MetaMask and
/// similar) so no WalletConnect project id is needed. Modular Wallet and
/// passkeys via Circle App Kit are a later upgrade that needs a kit key.
export const config = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: { [arcTestnet.id]: http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
