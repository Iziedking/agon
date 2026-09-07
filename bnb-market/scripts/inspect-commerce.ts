import { commerceReadiness } from "../src/shared/server/commerce.ts";
import { parseAgentId } from "../src/shared/types.ts";

// Signer-free commerce readiness inspection. The ID must identify a real BNB testnet agent.
const agentId = parseAgentId(process.argv[2] ?? "2114");
try {
  const readiness = await commerceReadiness(97, agentId);
  console.log(JSON.stringify({ ...readiness, sendsTransactions: false, runsProviderTasks: false }, null, 2));
} catch {
  console.error(JSON.stringify({ event: "commerce_read_unavailable", chainId: 97, agentId, sendsTransactions: false }));
  process.exitCode = 1;
}
