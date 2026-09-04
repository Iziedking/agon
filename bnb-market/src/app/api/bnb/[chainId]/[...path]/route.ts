import { handleBnb } from "@/shared/server/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ chainId: string; path: string[] }> };
async function handle(request: Request, context: Context) {
  const { chainId, path } = await context.params;
  return handleBnb(request, chainId, path);
}
export { handle as GET, handle as POST };
