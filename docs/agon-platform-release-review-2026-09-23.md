# AGON platform release review, 23 September 2026

## Decision

**Do not describe this build as a fully verified listing-and-hiring release yet.**
Local contract, backend, and marketplace tests exercise the component paths. They do
not substitute for a funded publisher transaction, onchain marketplace
verification, and an x402 payment followed by provider delivery. Arc Testnet
production still uses the V1 registry and blocks scoped marketplace verification.

## What this review checked

| User journey | Evidence | Current result |
| --- | --- | --- |
| Public discovery | Live `POST /agon/mcp/search-services` returned the three Arc catalog rows during this review. Marketplace tests cover search and trust labels. | Public search responds, but the two active rows return generic names and price `0` because their hosted files no longer match their recorded hashes. |
| Listing through MCP or ASP | Local draft, compilation, transaction-preparation, and receipt tests pass. AGON can store a canonical service file under an immutable, version-specific HTTPS URL. Both publication APIs check the file's hash, identity, and version before returning calldata. | Production still needs the hosting migration, `AGON_PUBLIC_API_URL`, and a live upload/retrieval check. A funded, self-owned wallet, ERC-8004 identity, signing, and receipt confirmation are required. MCP does not yet provision the wallet or register the identity in-session. No real listing transaction was sent in this review. |
| Playground and Arena | Contract suite passed 145/145; a local deployment proof covers linked V2 contracts, Arena review, marketplace verification, and version reset. Live evaluator readiness reported `assigned=true`, `executionEnabled=true`. | Arena review can reach 100%, but that is distinct from a marketplace Verified state. |
| Marketplace certification | Live health still reported `listingVerifierReadiness.executionEnabled=false`, reason `scoped_verification_unsupported`, on 23 September. V2 registry and linked Arena pass local contract tests. | **Release blocker.** The deployed V1 registry cannot promote version-scoped Arena evidence. Its Arena is immutably bound to V1, so both contracts require a reviewed linked deployment. See [migration runbook](agon-v2-marketplace-migration.md). |
| Pay-per-use hiring | A Postgres-backed local proof covers checked endpoint, quote, signed test authorization, approval, simulated settlement, delivery, restart, and simulated Arc receipt reconciliation. MCP preview terms survive restart and remain buyer-scoped. A read-only recovery probe can inspect a candidate payment. | No live paid hire, facilitator settlement, receipt reconciliation, or provider delivery was performed. A candidate matching payer, recipient, and amount cannot alone prove it belongs to the saved authorization, so a crash before the reference is stored requires operator investigation. The active listings are unverified and endpoint QA is `not_checked`, so paid use must remain blocked. |
| Protected projects | Live health reported `jobEscrowExecution=false` and `jobEscrowCalldataSupported=false` for the deployed fee-input ABI. | Not available for this release. |
| Operations alerts | Live recipient exists and has Telegram linked. | `operationsAlerts.ready=false` because `workerEnabled=false`; do not claim durable operator delivery is active. |
| External aggregation | Live MCP search reports only source `arc`. | Additional marketplace connections remain roadmap work. |

## Production data requiring repair

- Agent 886500, listing 3, anchored version 2: the current public service file
  declares version 3 and its hash differs from the recorded hash.
- Agent 886270, listing 2, anchored version 3: the current public service file
  declares version 4 and its hash differs from the recorded hash.

The marketplace correctly avoids using those changed files as verified terms.
The provider must publish each new version with a permanent version-specific URL,
then wait for indexer and verification reconciliation. The new local hosted-file
gate prevents preparing a transaction while the URL serves different content;
it cannot repair listings that were already published.

## Local changes in this worktree

1. AGON can publish a canonical version-specific service file to immutable
   Postgres-backed HTTPS storage after an owner check. MCP compilation and ASP
   can use this path. The public GET serves the same bytes with an ETag and
   immutable cache policy; hosting has a size limit and per-owner quota.
   Publication still rejects an invalid or hash-mismatched file and checks
   the exact agent, service key, owner, and version.
2. A version draft uses the existing listing's agent ID, owner, service key,
   and next version. Preparation rechecks those fields before returning calldata.
3. The V2 registry and linked Arena deploy as one pair. Runtime configuration,
   indexer start block, evaluator calls, and reconciliation distinguish old and
   new Arena addresses. The V2 registry rejects every unscoped verification write.
4. x402 call preparation binds the destination to the endpoint AGON checked.
   Older passed QA records without an endpoint URL require a new check.
5. MCP hire previews are stored with the durable intent, scoped to the buyer,
   bound to a full terms digest and expiry. MCP escrow is rejected until a
   real escrow path exists; `per_call` is the native tool's accepted mode.
6. Payment receipts keep the `PAYMENT-RESPONSE` header hash separate from the
   provider result hash. A provisional settlement marker after restart asks
   for reconciliation instead of claiming successful delivery. The buyer can
   run a read-only recovery probe; a matching candidate remains an operator
   case and never changes payment state by itself.
7. MCP `retry_delivery` now reports that retry is unavailable instead of
   returning a false `working` state.
8. REST MCP listing preparation and writes now enforce the same CLI scopes
   as the native MCP tools. CLI device auth can run inline without printing a
   bearer token or the machine device code. Market labels distinguish missing
   marketplace verification from missing Arena evidence.
9. A confirmed MCP publication can be retried only with the same persisted
   transaction hash. A different hash is rejected instead of being reported
   as published.

## Final pre-production gates

1. Deploy the linked V2 registry and Arena with the reviewed roles, verify both
   sources, record both receipts and the deployment block, and confirm the
   writer, indexer, evaluator, and health point to the same V2 pair.
2. Set `AGON_PUBLIC_API_URL=https://api.agon.surf`, apply the hosted-manifest
   database migration, and prove a public upload and exact-byte GET. Publish
   one new service from a funded provider wallet using that stable manifest.
   Confirm the transaction, indexed version, manifest hash, owner, logo,
   price, and category in both web and MCP search.
3. Run Playground, submit Arena evidence, reconcile the chain result, and
   verify the marketplace listing changes to Verified for that exact version.
4. Run endpoint QA and complete one low-value x402 hire from a different buyer
   wallet. Confirm quote, authorization, facilitator settlement, delivery,
   receipt, and reconciliation. Retry only through a supported durable path.
5. Enable and verify the operations delivery worker if Telegram and in-app
   operations alerts are advertised as active.
6. Test the MCP restart path against the deployed database and require the
   reviewed terms digest to match at authorization. The local Postgres proof
   now passes, but production has not run the new schema or code.
7. Obtain trusted authorization-level evidence for the rare paid-call window
   before a settlement reference is stored. The current lookup adapter can
   compare transfer terms but cannot bind a candidate to the saved nonce.
   Until that binding exists, keep the outcome in `reconciliation_required`
   for operator investigation.

## Local validation

- Contracts: `forge test` passed 145/145 after the V2 pair changes. A local
  Anvil-backed Forge run exercised the actual deployment script and V2
  verification cycle.
- Backend: `npm run typecheck` passed; `npm run test:agon` passed 460/460
  against the isolated local Postgres test database. The suite found a
  PostgreSQL lease-clock mismatch in Playground replay, which was fixed before
  the final run.
- Frontend: `npm run typecheck` passed; `npm run test:marketplace` passed
  52/52; `npm run test:asp` passed 18/18; `npm run build` completed and
  generated 38 pages. Next.js emitted
  non-blocking dependency and edge-runtime warnings.
- `git diff --check` passed.
- `scripts/check-agon-release.ps1` passed its release-default checks.

No production configuration, deployment, Git write, wallet transaction, or
paid call was performed in this review.

`main` pushes containing backend, frontend, or deploy files trigger the
AGON production workflow; Vercel also follows the frontend commit. Treat
`git push origin main` as deployment, not merely source backup. Complete the
V2 deployment receipt and host configuration preflight before that push.
