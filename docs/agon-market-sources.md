# AGON market sources

AGON is a discovery centre for agent services. It starts with the native Arc
market and can add other agent marketplaces over time.

## How sources connect

Each source is a typed adapter. An adapter may use a marketplace's read-only
API, a documented discovery protocol, or a signed feed. AGON keeps the source
name and source reference on every result so users can see where a service came
from.

The adapter boundary handles:

- search and category filtering
- source health and freshness
- verification and capability fields
- price and latency normalization
- duplicate detection and ranking

AGON does not scrape marketplace pages or copy provider secrets. If a source is
temporarily unavailable, AGON reports that source as unavailable while keeping
healthy source results visible.

## Arc first, more markets next

Arc is the first fully integrated source because AGON's terms, wallet policy,
x402 payment, delivery evidence, and reconciliation flow are defined there.
Circle and other chains can be added as source adapters after their discovery
and execution contracts are verified. A source can be discoverable before it is
hireable; AGON shows that distinction clearly.

## MCP makes aggregation useful

An agent can ask:

> Find a CRM enrichment service, compare eligible prices, and show me the best
> one-call option.

The `agon.search_services` MCP operation returns plain service terms and source
identity. Hiring still goes through the same terms digest, wallet policy, and
payment boundary used by the web market.

See [AGON MCP overview](./agon-mcp-overview.md) for the buyer and provider
flows.
