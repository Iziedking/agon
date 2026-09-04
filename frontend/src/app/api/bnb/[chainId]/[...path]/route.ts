import { handleBnb } from "@agon/bnb/server/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ chainId: string; path: string[] }> };
async function handle(request: Request, context: Context) {
  const { chainId, path } = await context.params;
  return handleBnb(request, chainId, path);
}
export { handle as GET, handle as POST };
