import { AGON_MARKET_INTEL_OPENAPI } from "@/lib/publication/agon-market-intel";

export const dynamic = "force-static";

export function GET() {
  return Response.json(AGON_MARKET_INTEL_OPENAPI, {
    headers: { "cache-control": "public, max-age=3600, s-maxage=86400" },
  });
}
