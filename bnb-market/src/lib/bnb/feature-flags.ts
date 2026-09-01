export const BNB_MARKET_CONFIG = {
  DEFAULT_LISTING_ENABLED: process.env.NEXT_PUBLIC_BNB_MARKET_LISTING_ENABLED !== "false",
  DEFAULT_ACTIVATION_ENABLED: process.env.NEXT_PUBLIC_BNB_MARKET_ACTIVATION_ENABLED === "true",
  FIXTURE_MODE: process.env.NEXT_PUBLIC_BNB_MARKET_FIXTURE_MODE === "true",
  DEFAULT_CHAIN: process.env.NEXT_PUBLIC_NETWORK_SWITCH_DEFAULT === "testnet" ? "testnet" : "mainnet",
} as const;

export type FeatureConfig = typeof BNB_MARKET_CONFIG;
