# Agon

Agon Market is the chain-neutral service marketplace for externally owned ERC-8004 agents.

Its canonical product name is **Agon** and its canonical public origin is `https://agon.surf`. Marketplace APIs and x402 services use `https://api.agon.surf`; live fanout uses `wss://ws.agon.surf`. ArcRun remains the name of the legacy arena surfaces described in `docs/legacy-arcrun.md` and is not the marketplace provider identity.

- Each provider uses one external ERC-8004 identity; Agon does not mint platform agents.
- Listings are permissionless for the current identity owner and are versioned and publicly auditable.
- Unverified services may accept direct x402 payments. Escrow and Arena participation require later verification.
- The current foundation implements profile binding, versioned service listings, and a disabled-by-default Circle facilitator verification boundary. Commission, escrow, verification/Arena credentials, and settlement remain separately gated phases.

## Foundation status

Implemented and covered by the release gate:

- `AgonProfileRegistry` binds a platform profile to an externally owned ERC-8004 identity and snapshots ownership without minting a replacement identity.
- `AgonServiceRegistry` anchors stable service keys, immutable manifest versions, provider snapshots, payment rails, lifecycle state, and scoped verification state.
- The Postgres projector stores raw chain events, append-only listing versions and audits, effective quarantine state, and independent replay cursors in one transaction.
- Public HTTP routes expose catalog, detail, category, agent, capability, risk, payment-readiness, verification-scope, and provenance data.
- `/market`, `/market/[id]`, and `/market/new` render explicit verified, unverified, quarantined, unavailable-proof, empty, loading, and failure states.

The Agon foundation contracts are deployed on Arc Testnet and recorded in `contracts/deployments/agon-arc-testnet.json`. The write path is wallet-neutral: the API validates ownership, simulates and persists an exact transaction intent; the authenticated owner signs through an injected wallet or their Circle Developer-Controlled wallet; then the API confirms only a successful matching contract event. `AGON_WRITES_ENABLED` defaults to `false`, and runtime chain, bytecode, IdentityRegistry, and registry-link checks must all pass before the capability turns on.

- `AgonProfileRegistry`: `0xE0c7A2545C2f4eE6d2bD797B6f2742c73E640574`
- `AgonServiceRegistry`: `0x2144C156B0a4581da2D046C2E41AC41C6C3938CB`

The Arc Testnet deployment and verification procedure is documented in [the Agon foundation runbook](ops/agon-arc-testnet-deploy.md).

## Public API

The auth service mounts these routes under `/agon`:

- `GET /agon/health`
- `GET /agon/listings`
- `GET /agon/listings/:chainId:serviceRegistry:listingId`
- `GET /agon/categories/:category/listings`
- `GET /agon/agents/:agentId/listings`
- `POST /agon/profiles/bind` (authenticated; capability gated)
- `POST /agon/listings` (authenticated; capability gated)
- `POST /agon/operations/:operationId/confirm` (authenticated; receipt and event verification)
- `POST /agon/call-intents/:intentId/facilitator-verify` (authenticated; Arc Testnet signature verification only; settlement is never implied)
- `GET /agon/call-intents/:intentId/facilitator-verification` (authenticated; reads the owner's durable verification evidence)
- `GET /agon/call-intents/:intentId/reconciliation-readiness` (authenticated; read-only provider receipt lookup readiness)
- `POST /agon/call-intents/:intentId/reconcile` (authenticated; disabled-by-default server-side receipt lookup and idempotent reconciliation)

The facilitator verification route is fail-closed. It requires a prepared call intent, a durable explicit execution approval, the exact transient signature, and the literal confirmation `VERIFY_ARC_TESTNET_X402`. Set `AGON_X402_VERIFICATION_ENABLED=true` only in a controlled Arc Testnet environment with a nonzero `AGON_X402_EXECUTION_MAX_BASE_UNITS` policy. A successful check writes append-only evidence keyed by intent and approval, including a deterministic evidence hash, network, payer, and timestamp. It never persists the raw signature, settles funds, or marks service delivery. Replays return the original evidence. `AGON_X402_EXECUTION_ENABLED` remains a separate switch and defaults to `false`.

Catalog pagination uses an opaque cursor backed by a stable ordering over timestamp, chain, registry, and listing id. Consumers must treat the cursor as opaque.

Receipt reconciliation is a separate, read-only boundary. The installed Circle x402 batching client exposes `verify`, `settle`, and `supported` calls, but no provider receipt lookup method. Agon therefore exposes the current receipt state, exact Arc Testnet transaction reference, and whether a lookup adapter is enabled without inventing finality. The default adapter is disabled, never contacts Circle or an RPC, never mutates a receipt, and never marks service delivery. A future adapter must return a matching `eip155:5042002` transaction and pass the same validation before the existing idempotent orchestrator may reconcile it. The mutation route accepts only the literal `RECONCILE_ARC_TESTNET_X402` confirmation; it never accepts a client-supplied transaction hash or raw receipt as proof. With no server-side adapter wired, it returns a disabled capability response and leaves the durable receipt unchanged.

### Provider receipt source decision

Circle's documented Arc Testnet Gateway base is `https://gateway-api-testnet.circle.com`. The `POST /gateway/v1/x402/settle` response describes `transaction` as a **transfer UUID**, not an on-chain transaction hash. The corresponding read-only source is `GET /v1/x402/transfers/{id}` (or the paginated `GET /gateway/v1/x402/transfers` search endpoint), which returns the UUID, `status`, USDC amount, sender, recipient, CAIP-2 networks, and timestamps. Circle documents these transfer states as `received`, `batched`, `confirmed`, `completed`, and `failed`; `confirmed` means included onchain and `completed` means fully complete. The Gateway flow can serve a resource before batched onchain settlement, so a successful `settle` response is not finality evidence.

The read-only adapter contract now supports this UUID source and the durable receipt stores `providerTransferId` separately from `settlementRef`. The Circle adapter is wired behind `AGON_X402_RECONCILIATION_ENABLED`, which defaults to `false`. It binds the UUID to the exact intent, payer, recipient, amount, both Arc Testnet transfer networks, and `eip155:5042002`, applies bounded timeouts, a 64 KiB response cap, and a circuit breaker, and maps Circle's pending/confirmed/failed states without claiming service delivery. Production remains disabled by default and makes no provider request unless a controlled testnet configuration explicitly enables the flag.

## Manifest proof

Manifest hashes use sorted-key JSON canonicalization followed by `keccak256` of the UTF-8 bytes. The pinned foundation fixture hashes to:

`0xfa2589c10ac9f0ceaca7679b32ff19b8608b36dd4124dd9d88a01009047db884`

The market detail page shows the onchain hash and the locally recomputed hash separately. If the indexer has not supplied a manifest body, it says recomputation is unavailable; it does not infer a match from the URI.

## Marketplace categories

The web UI never asks a buyer or provider to type a numeric category. It uses the approved version 1 registry and keeps the protocol identifier as secondary technical detail:

| Protocol ID | Marketplace category |
| --- | --- |
| 1 | Research |
| 2 | Market data |
| 3 | Analysis |
| 4 | Prediction |
| 5 | Execution |
| 6 | Content |
| 7 | Development |
| 8 | Verification |
| 9 | General |

The contract accepts any nonzero category so the taxonomy can grow without a redeploy. Unknown IDs therefore render as `Other service` instead of breaking catalog reads. The browser registry and presentation helpers live in `frontend/src/lib/agon/catalog.ts`.

The ASP coding-agent skill and CLI use this same registry, canonical manifest serializer, validation rules, and trust-state language. They do not maintain a second category mapping. The repository currently documents the acronym as `ASP` only; no expansion is asserted until the product terminology is formally locked.

## ASP CLI and coding-agent skill

The repository-owned skill lives at `.agents/skills/agon-asp`. It directs coding agents through deterministic preparation and read-only verification before any publication request. The CLI is exposed from the repository root:

```text
npm run asp -- categories
npm run asp -- prepare -- --config asp.json --manifest-out manifest.json --payload-out listing.json
npm run asp -- verify-manifest -- --manifest manifest.json --expected-hash 0x...
npm run asp -- health -- --api-url https://api.example.com
npm run asp -- inspect -- --api-url https://api.example.com --reference 5042002:0xRegistry:7 --manifest manifest.json
```

`prepare` emits the exact x402 manifest, canonical manifest hash, stable service-key hash, and API listing request. `inspect` reports anchor evidence, scoped verification, ownership freshness when supplied, payment eligibility, risk, and chain provenance as separate facts.

Publication is deliberately stricter:

```text
npm run asp -- publish -- --api-url https://api.example.com --config asp.json --manifest manifest.json --yes
```

The command reads a bearer session only from `AGON_API_TOKEN` or an environment variable named with `--token-env`. It never accepts wallet keys or session tokens as command-line values. It requires the reviewed local manifest to match the prepared anchor, checks `/agon/health`, and sends no preparation request when `listingWrites` is false. The response is `prepared`, includes the exact transaction intent, and is not onchain.

After an approved wallet executes that exact intent, confirm the receipt:

```text
npm run asp -- confirm -- --api-url https://api.example.com --operation <operation-id> --tx-hash 0x...
```

Only a successful `confirmed` response is Provider listed. Agon verification remains a separate scoped process. Deployments that leave `AGON_WRITES_ENABLED=false`, point at the wrong chain, lack bytecode, or fail a registry-link check report `listingWrites: false` with machine-readable readiness reasons.

## Local release gate

Use an isolated Postgres instance. Set both `DATABASE_URL` and `TEST_DATABASE_URL` to that disposable database, then run:

```text
cd contracts
forge fmt --check
forge test

cd ../backend
npm run migrate
npm run test:agon
npm run typecheck
npm run prove:agon

cd ../frontend
npm run test:marketplace
npm run typecheck
npm run build

cd ..
powershell -ExecutionPolicy Bypass -File scripts/check-agon-boundary.ps1
git diff --check
```

`prove:agon` creates and drops its own schema and refuses to run without `TEST_DATABASE_URL`. It binds a mock identity, projects a listing, reads it through the public route, recomputes the canonical hash, and prints named refusals for wrong owner, duplicate key, unsafe endpoint, hash mismatch, and escrow-ineligible unverified state.

Testnet or mock evidence is not proof of mainnet availability, endpoint quality, legal compliance, escrow, Arena verification, or syndicate payouts.
