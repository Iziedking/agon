import assert from "node:assert/strict";

// Read-only route smoke against an already-running local build. This never
// connects a wallet, calls an agent, or submits a request.
const base = new URL(process.argv[2] ?? "http://localhost:4000");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "Use a local server, not production.");
const routes = [
  "/market",
  "/market?category=rebalancing&network=bnb-mainnet",
  "/market?category=grid-trading&network=bnb-mainnet",
  "/market?category=yield-optimisation&network=bnb-mainnet",
  "/market?category=health-factor&network=bnb-mainnet",
  "/market/compare?ids=2177&network=bnb-testnet",
  "/market/activity?network=bnb-testnet",
  "/market/provider?network=bnb-mainnet",
  "/market/new?network=bnb-mainnet",
];
for (const route of routes) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200, `${route} must render`);
  const html = await response.text();
  assert.match(html, /<main[\s>]/, `${route} needs a main landmark`);
  assert.match(html, /<h1[\s>]/, `${route} needs a page heading`);
  assert.doesNotMatch(html, /Application error: a (?:client|server)-side exception/);
  console.log(`PASS ${route}`);
}
console.log("Route shells passed. Dynamic data, controls and responsive behavior require browser checks.");
