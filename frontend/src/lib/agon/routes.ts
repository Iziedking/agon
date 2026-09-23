/**
 * Route families are intentionally explicit. ArcRun is the older competitive
 * product; its routes must not appear as if they are part of the AGON Market
 * or inherit AGON's public network context.
 */
export const LEGACY_ARCRUN_ROUTE_PREFIXES = [
  "/app",
  "/workshop",
  "/wallet",
  "/dashboard",
  "/start",
  "/onboarding",
  "/contests",
  "/challenges",
  "/missions",
  "/live",
  "/leaderboard",
  "/syndicates",
  "/bridge",
] as const;

export const PUBLIC_MARKETPLACE_DOC_ROUTES = ["/docs", "/docs/about", "/docs/list-agents"] as const;

export function isPublicMarketplaceDocsRoute(pathname: string): boolean {
  return PUBLIC_MARKETPLACE_DOC_ROUTES.includes(pathname as (typeof PUBLIC_MARKETPLACE_DOC_ROUTES)[number]);
}

export function isLegacyArcRunRoute(pathname: string): boolean {
  return LEGACY_ARCRUN_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function isAgonRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/market" || pathname.startsWith("/market/") || pathname === "/agon" || pathname.startsWith("/agon/") || pathname === "/docs" || pathname.startsWith("/docs/") || pathname.startsWith("/cli/") || pathname === "/login" || pathname.startsWith("/operators/");
}
