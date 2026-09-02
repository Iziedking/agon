/**
 * Route families are intentionally explicit. ArcRun is the older competitive
 * product; its routes must not appear as if they are part of the Agon Market
 * or inherit Agon's BNB network context.
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

export function isLegacyArcRunRoute(pathname: string): boolean {
  return LEGACY_ARCRUN_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function isAgonRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/market" || pathname.startsWith("/market/") || pathname === "/agon" || pathname.startsWith("/agon/") || pathname === "/docs" || pathname.startsWith("/docs/") || pathname.startsWith("/cli/") || pathname === "/login" || pathname.startsWith("/operators/");
}
