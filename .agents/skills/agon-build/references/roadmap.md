# Agon public roadmap

This is the public, sanitized roadmap for coding agents. It summarizes the
product direction without exposing private hackathon planning, credentials,
wallet operations, unpublished addresses, or internal operator notes.

## Already implemented or present in the repository

- AGON brand and public landing presentation;
- public service discovery, detail, manifest, and trust-state concepts;
- AGON Playground surface;
- ASP CLI and skill for prepare, manifest verification, publish preparation,
  confirmation, inspection, evaluation, and verification requests;
- Arc Testnet client, contract inventory, public explorer links, and Arc
  foundation deployment records;
- explicit public versus protected route gate;
- fixture or preview paths for safe local review;
- legacy ArcRun arena routes retained behind a compatibility boundary.

## Next product layer

### Network foundation

Create a typed network registry for BNB Mainnet, BNB Testnet, and Arc Testnet.
Move chain id, RPC, explorer, identity, Agon contract inventory, payment
asset, capabilities, and wallet switching behind the registry. Make BNB
Mainnet the default for Agon presentation and keep Arc-only legacy routes
isolated.

### BNB-led public product

Make the landing page describe Agon with BNB as the head chain. Add the compact
top-right BNB control and the Mainnet/Testnet switch. The testnet page must
switch between BNB Testnet and Arc Testnet. Every switch must route to its
dedicated data context and show honest availability.

### Catalog and trust

Connect curated, source-backed agent records. Treat 8004scan as discovery or
enrichment only when the integration proves its response and freshness. Direct
chain reads and service endpoint checks govern ownership, writes, evidence,
and payments. Do not dump unqualified identities into the market.

### Playground

Allow a visitor to test an exact service version in a bounded sandbox before a
hire or protected write. Persist the run identity and evidence scope. Make
fixtures visibly non-activatable. A Playground score is not automatically an
official verification record.

### Protected actions

Implement listing, authority, hire, payment, delivery, receipt, revoke, and
dispute flows one at a time. Each flow needs durable intent before side effect,
explicit user review, idempotency, reconciliation, and a recovery surface.

### Trust and evidence

Keep identity, ownership, endpoint freshness, authority, delivery, payment,
reviews, and category results as separate evidence sources. A score applies to
one exact version and category. Do not publish a single opaque trust number
without the evidence stack behind it.

## Non-goals until the evidence exists

- no generic AI chat wrapper as the product;
- no fake live agents, fake onchain receipts, or fake partner metrics;
- no silent Arc-to-BNB contract reuse;
- no wallet custody or private-key handling in the frontend skill;
- no mainnet write CTA before deployment and receipt verification;
- no broad migration of legacy ArcRun competition routes without a dated
  decision and complete chain adapter;
- no public copy of private planning or operator documents.
