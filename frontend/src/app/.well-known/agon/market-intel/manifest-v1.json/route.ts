import {
  AGON_MARKET_INTEL_MANIFEST,
  AGON_MARKET_INTEL_MANIFEST_HASH,
} from "@/lib/publication/agon-market-intel";

export const dynamic = "force-static";

export function GET() {
  return Response.json(AGON_MARKET_INTEL_MANIFEST, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${AGON_MARKET_INTEL_MANIFEST_HASH.slice(2)}"`,
    },
  });
}
