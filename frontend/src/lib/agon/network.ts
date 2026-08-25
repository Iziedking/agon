/**
 * Public network presentation for AGON.
 *
 * The product name is intentionally separate from the current deployment
 * environment. Adding another chain should add a network adapter and select
 * its descriptor here, rather than leaking one chain's name into the brand.
 */
export type AgonNetworkDescriptor = {
  environment: string;
  name: string;
  chainId: string;
  gasAsset: string;
  explorerUrl: string;
};

const value = (key: string, fallback: string) => {
  const configured = process.env[key]?.trim();
  return configured || fallback;
};

export const AGON_NETWORK: AgonNetworkDescriptor = {
  environment: value("NEXT_PUBLIC_AGON_NETWORK_ENVIRONMENT", "TESTNET"),
  name: value("NEXT_PUBLIC_AGON_NETWORK_NAME", "Arc Testnet"),
  chainId: value("NEXT_PUBLIC_AGON_CHAIN_ID", "5042002"),
  gasAsset: value("NEXT_PUBLIC_AGON_GAS_ASSET", "USDC"),
  explorerUrl: value("NEXT_PUBLIC_AGON_EXPLORER_URL", "https://testnet.arcscan.app"),
};

export const AGON_NETWORK_LABEL = `NETWORK ${AGON_NETWORK.chainId}`;
export const AGON_NETWORK_DETAIL = `${AGON_NETWORK.name} / CHAIN ${AGON_NETWORK.chainId}`;
