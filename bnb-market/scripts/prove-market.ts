import { categoryCoverage, categoryCoverageGaps } from "../src/shared/marketplace/category-coverage.ts";
import { catalog } from "../src/shared/server/catalog.ts";

// Read-only marketplace proof. It never loads a private key, signs, funds, or runs a provider task.
try {
  const chainId = 97;
  const pages: Awaited<ReturnType<typeof catalog>>[] = [];
  let offset = 0;
  for (let page = 0; page < 10; page += 1) {
    const result = await catalog(chainId, offset);
    pages.push(result);
    if (result.nextOffset === null) break;
    offset = result.nextOffset;
  }
  const agents = [...new Map(pages.flatMap((page) => page.items).map((agent) => [agent.id, agent])).values()];
  const coverage = categoryCoverage(agents);
  const gaps = categoryCoverageGaps(coverage);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    chainId,
    catalogSource: "8004scan",
    indexedProfiles: agents.length,
    coverage,
    gaps,
    status: gaps.length === 0 ? "all_required_outcomes_present" : "honest_coverage_gaps",
    sendsTransactions: false,
    runsProviderTasks: false,
  }, null, 2));
  if (!agents.length) throw new Error("No live BNB Testnet agents returned by the catalog.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Marketplace proof failed");
  process.exitCode = 1;
}
