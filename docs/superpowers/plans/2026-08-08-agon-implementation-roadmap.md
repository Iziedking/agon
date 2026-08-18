# Agon Protocol Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each linked plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the active ArcRun game model with Agon, a chain-neutral ERC-8004 agent marketplace with direct x402 services, adversarial verification, advanced-work escrow, multi-owner syndicates, and auditable MCP/skill onboarding.

**Architecture:** The work is split into independently shippable plans so identity/listing, payments, escrow, Arena verification, syndicates, and distribution can be tested and deployed without coupling every release. Legacy contracts remain readable but are removed from active product paths.

**Tech Stack:** Solidity 0.8.24, Foundry 1.7.1, OpenZeppelin 5, ERC-8004, TypeScript 5.9.3, Node 22, Hono, viem, Postgres, Next.js 15, React 19, x402, USDC.

---

## Plan sequence

1. **Agon market foundation** — brand boundary, legacy archival, external ERC-8004 profile binding, versioned service registry, backend projection, permissionless discovery, unverified warnings.
2. **Agon direct x402 rail** — provider endpoint protocol, payment receipt ingestion, optional routing, reliability metrics, verified paid reviews, no custody.
3. **Agon job escrow** — advanced jobs, negotiated duration, 35-hour default, configurable bounds, delivery, acceptance, auto-acceptance, refund, multisig dispute decision.
4. **Agon Arena verification** — hidden adversarial tracks, evidence roots, private 50/100 threshold, scoped credentials, expiry/suspension/revocation, verification-gated features.
5. **Agon syndicates and prize vault** — multi-owner agent membership, locked rosters, contribution scoring, USDC pools, Merkle pull claims.
6. **Agon rating and reputation** — Arena consistency 60%, verified reviews 30%, reliability 10%, confidence/recent weighting and anti-sybil controls.
7. **Agon frontend migration** — Agon Market, Arena, Syndicates, Escrow, profile surfaces; remove active tier/training/trait/mystery-box navigation.
8. **Agon MCP and Skills** — identity binding, manifest validation, listing, QA, verification, x402, jobs, syndicates, Arena, evidence and payout workflows.
9. **Testnet deployment and archive cutover** — deploy six contracts in dependency order, prove flows, publish receipts, switch active APIs, retain legacy read-only history.

## Dependency graph

```text
Market foundation
  +-- Direct x402 rail --+
  +-- Job escrow --------+-- Rating and reputation
  +-- Arena verification ¦
          +-- Syndicates +

All protocol plans --> Frontend migration --> MCP/Skills --> Testnet cutover
```

## Deployment target

New contracts:

1. `AgonProfileRegistry`
2. `AgonServiceRegistry`
3. `AgonPrizeVault`
4. `AgonJobEscrow`
5. `AgonArena`
6. `AgonSyndicateRegistry`

Legacy active flows to archive: `AgentRegistry`, `ContestEngine`, `ChallengeArena`, `SyndicateFactory`, `PointsLedger`, `PrizeEscrow`, and the marketplace `ServiceRegistry` prototype.

## Global gates

- No new public API, contract, package, or UI uses the ArcRun name.
- No active feature depends on tiers, training, traits, mystery boxes, or platform-minted agents.
- Every privileged action rechecks external ERC-8004 ownership.
- Every on-chain projector is idempotent by `(chain_id, tx_hash, log_index)`.
- Direct x402 payments never enter Agon custody.
- Escrow and prize balances are isolated by job or competition ID.
- No address is documented before a successful deployment receipt.
- Each plan passes Foundry, backend tests/typecheck, frontend tests/build, migration replay, proof scripts, secret scans, and `git diff --check`.
