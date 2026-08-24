import { config } from "../src/config/index.ts";
import { publicClient } from "../src/chain/arc.ts";
import { inspectAgonReadiness } from "../src/agon/write/readiness.ts";

const readiness = await inspectAgonReadiness({
  enabled: config.agon.writesEnabled,
  configuredChainId: config.chainId,
  deployment: config.agon.deployment,
  client: publicClient,
});

console.log(JSON.stringify({
  status: readiness.ready ? "ready" : "blocked",
  chainId: config.chainId,
  deployment: config.agon.deploymentPath,
  checkedAt: readiness.checkedAt,
  reasons: readiness.reasons,
}, null, 2));

if (!readiness.ready) process.exitCode = 1;
