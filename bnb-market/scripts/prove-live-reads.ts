import { catalog, agentDetail } from "../src/shared/server/catalog.ts";
import { checkedClient, networkConfig } from "../src/shared/server/network.ts";

// Read-only proof. Never loads a private key, signs or broadcasts a transaction.
try {
  const chainId = 97; const config = networkConfig(chainId); const client = await checkedClient(chainId);
  const bytecode = await client.getCode({ address: config.registry });
  const page = await catalog(chainId);
  const first = page.items[0]; if (!first) throw new Error("No indexed testnet agent returned");
  const detail = await agentDetail(chainId, first.id, true);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), chainId, registry: config.registry, registryHasCode: !!bytecode && bytecode !== "0x", indexedProfiles: page.total, inspectedAgentId: detail.id, owner: detail.owner, indexedOwnerMatchesChain: first.owner.toLowerCase() === detail.owner.toLowerCase(), block: detail.blockNumber, metadata: detail.metadataStatus, services: detail.services, registrationMatches: detail.registrationMatches, paymentsSent: 0 }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.name : "ReadFailure"); process.exitCode = 1; }
