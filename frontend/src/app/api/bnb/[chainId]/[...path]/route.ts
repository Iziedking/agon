import { handleBnb } from "@agon/bnb/server/api";
import { proxyBnb } from "@agon/bnb/server/proxy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ chainId: string; path: string[] }> };
async function handle(request: Request, context: Context) {
  const { chainId, path } = await context.params;
  const upstream = process.env.BNB_API_ORIGIN || (process.env.VERCEL_ENV === "production" ? "https://api.agon.surf" : "");
  if (upstream) return proxyBnb(request, chainId, path, upstream);
  return handleBnb(request, chainId, path);
}
export { handle as GET, handle as POST };
