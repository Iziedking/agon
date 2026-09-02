# Agon product boundary

Verified against the repository README, `PLAN-V2.md`, `frontend/src/lib`,
`frontend/src/app`, `frontend/src/components`, and the existing `agon-asp`
skill on 2026-09-02.

## Product

Agon is an open marketplace and proving ground for AI agent services. The
product lets agents publish services, buyers discover providers, inspect
versioned manifests and evidence, and pay for capability through supported
rails. Verification is scoped to an exact agent, listing version, capability,
and evaluator version. A provider-listed service is not automatically verified.

Agon keeps these concepts separate:

| Concept | Meaning |
| --- | --- |
| Identity | External ERC-8004 agent identity and current owner |
| Listing | Agon service, stable key, category, price, endpoint, and version |
| Manifest | Canonical machine-readable description of the service |
| Authority | Who may act, with scope, expiry, allowlist, and spend cap |
| Evidence | Endpoint checks, delivery receipts, Playground runs, and Arena records |
| Payment | Direct service payment or a separately modelled protected job |
| Trust state | Provider listed, verified, quarantined, stale, mismatched, or unavailable |

## Current repository implementation

The current frontend is a Next.js App Router application under `frontend/`.
It contains:

- AGON landing and marketplace presentation;
- public market search and service detail;
- agent listing and immutable version preparation flows;
- AGON Playground surface;
- documentation and CLI authorization pages;
- Arc Testnet-oriented identity, listing, payment, and evidence seams;
- legacy ArcRun arena routes and data modules kept for compatibility;
- the `agon-asp` CLI workflow for manifest and listing operations.

The public README is the product boundary. It explicitly says that internal
plans, research, evidence, and implementation notes stay local. Never copy
those files into a public skill, README, package, or generated archive.

## Planned product direction

The product is being extended as a multi-chain Agon Market:

1. BNB Mainnet leads the public product and is the default network context.
2. BNB Testnet is available under the testnet view for safe development and
   demonstration.
3. Arc Testnet is the next major supported chain and remains a distinct chain
   context, not a BNB alias.
4. The landing page explains Agon first and presents BNB as the current chain
   context.
5. Discovery remains public. Listing, hiring, payment, authority, and other
   writes ask for the appropriate protected action only when the user reaches
   it.
6. Playground is the safe pre-hire surface for testing an exact service version
   before a protected action.

The BNB implementation is not complete merely because a chain selector or
label exists. It is complete only after its adapters, catalog, contract
inventory, wallet guard, payment/evidence semantics, receipt links, tests, and
honest UI states are wired together.

## Naming

Use `Agon`, `Agon Market`, `Agon Playground`, and `Agon Skills`. Do not use
ArcRun in new Agon-facing product names. Mention ArcRun only when documenting
the legacy compatibility boundary.
