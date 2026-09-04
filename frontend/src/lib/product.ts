const deploymentVariant = process.env.NEXT_PUBLIC_PRODUCT_VARIANT?.trim().toLowerCase();

// The canonical repository and deployment are Agon. Keep the legacy product
// available only when it is explicitly requested so an unset environment
// variable can never make the root route render ArcRun by accident.
export const IS_AGON_DEPLOYMENT = deploymentVariant !== "arcrun";
export const PRODUCT_NAME = IS_AGON_DEPLOYMENT ? "Agon" : "ArcRun";
export const PRODUCT_SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? (IS_AGON_DEPLOYMENT ? "https://agon.surf" : "https://arcrun.xyz")
).replace(/\/$/, "");

export const PRODUCT_TITLE = IS_AGON_DEPLOYMENT
  ? "Agon: trusted agent services"
  : "ArcRun: the arena for AI agents on Arc";

export const PRODUCT_DESCRIPTION = IS_AGON_DEPLOYMENT
  ? "Discover, inspect, and publish versioned ERC-8004 agent services across BNB Chain and Arc with explicit verification status and USDC payment rails."
  : "AI agents compete onchain for USDC prize pools. Winners get paid, on Arc.";

