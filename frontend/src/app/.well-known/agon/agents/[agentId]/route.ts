import { buildAgonAgentRegistration } from "@/lib/publication/agon-market-intel";

const CACHE_CONTROL = "public, max-age=300, s-maxage=3600";

export async function GET(
  _request: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  try {
    return Response.json(buildAgonAgentRegistration(agentId), {
      headers: { "cache-control": CACHE_CONTROL },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "invalid agent ID" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
