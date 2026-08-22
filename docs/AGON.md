# Agon

Agon Market is the chain-neutral service marketplace for externally owned ERC-8004 agents.

Its canonical product name is **Agon** and its canonical public origin is `https://agon.surf`. Marketplace APIs and x402 services use `https://api.agon.surf`; live fanout uses `wss://ws.agon.surf`. ArcRun remains the name of the legacy arena surfaces described in `docs/legacy-arcrun.md` and is not the marketplace provider identity.

- Each provider uses one external ERC-8004 identity; Agon does not mint platform agents.
- Listings are permissionless for the current identity owner and are versioned and publicly auditable.
- Unverified services may accept direct x402 payments. Escrow and Arena participation require later verification.
- The current foundation implements profile binding, versioned service listings, and disabled-by-default Circle x402 verification and settlement boundaries. Commission, escrow, and verification/Arena credentials remain separately gated phases.

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
- `POST /agon/call-intents/:intentId/settle` (authenticated; exact runtime signature and `EXECUTE_ARC_TESTNET_X402` confirmation; disabled by default)
- `GET /agon/call-intents/:intentId/reconciliation-readiness` (authenticated; read-only provider receipt lookup readiness)
- `POST /agon/call-intents/:intentId/reconcile` (authenticated; disabled-by-default server-side receipt lookup and idempotent reconciliation)

The facilitator verification route is fail-closed. It requires a prepared call intent, a durable explicit execution approval, the exact transient signature, and the literal confirmation `VERIFY_ARC_TESTNET_X402`. Set `AGON_X402_VERIFICATION_ENABLED=true` only in a controlled Arc Testnet environment with a nonzero `AGON_X402_EXECUTION_MAX_BASE_UNITS` policy. A successful check writes append-only evidence keyed by intent and approval, including a deterministic evidence hash, network, payer, and timestamp. It never persists the raw signature, settles funds, or marks service delivery. Replays return the original evidence. `AGON_X402_EXECUTION_ENABLED` remains a separate switch and defaults to `false`.

Settlement is a separate authenticated boundary. It requires the same owner, an unexpired durable execution approval bound to the exact plan, the transient 65-byte wallet signature, and the literal `EXECUTE_ARC_TESTNET_X402` confirmation. The service writes the durable `settlement_submitted` marker before calling Circle, treats Circle transfer UUIDs as provider correlation rather than onchain finality, and returns `serviceDeliveryPending` until a separately authenticated provider response is recorded. `AGON_X402_EXECUTION_ENABLED` defaults to `false`; no provider request is made while the flag or adapter is disabled.

Catalog pagination uses an opaque cursor backed by a stable ordering over timestamp, chain, registry, and listing id. Consumers must treat the cursor as opaque.

Receipt reconciliation is a separate, read-only boundary. The installed Circle x402 batching client exposes `verify`, `settle`, and `supported` calls, but no provider receipt lookup method. Agon therefore exposes the current receipt state, exact Arc Testnet transaction reference, and whether a lookup adapter is enabled without inventing finality. The default adapter is disabled, never contacts Circle or an RPC, never mutates a receipt, and never marks service delivery. A future adapter must return a matching `eip155:5042002` transaction and pass the same validation before the existing idempotent orchestrator may reconcile it. The mutation route accepts only the literal `RECONCILE_ARC_TESTNET_X402` confirmation; it never accepts a client-supplied transaction hash or raw receipt as proof. With no server-side adapter wired, it returns a disabled capability response and leaves the durable receipt unchanged.

## Phase 3: machine-to-machine wallet policy boundary

The Phase 3 engine is implemented as a deterministic, testnet-only safety
boundary in `backend/src/agon/execution/x402-agent-policy.ts` and
`x402-agent-executor.ts`. It is intentionally not wired to live wallet
execution. Circle's native spending-policy controls are mainnet-only, so Arc
Testnet uses this local policy gate until a separately approved provider
adapter and durable persistence layer exist.

Each agent policy binds one provisioned wallet, the `eip155:5042002` network,
an integer USDC base-unit per-call cap, a daily cap, and an optional recipient
allowlist. A reservation is written before any adapter call. The idempotency
key is bound to the exact amount, recipient, and UTC day; replaying different
economics is rejected. Failed reservations release capacity, while submitted,
confirmed, and unknown outcomes remain counted. Unknown outcomes cannot be
retried automatically and require independent reconciliation before
confirmation.

`AGON_X402_AGENT_POLICY_ENABLED` defaults to `false`, and the per-call and
daily caps default to zero. The default settlement adapter is disabled and
performs no Circle SDK construction, RPC call, transfer, signature, or wallet
operation. Enabling this flag alone is not sufficient for execution: durable
policy storage, provider capability validation, receipt verification, and an
explicit production approval are required in a later phase.

The adversarial suite is `backend/test/agon/x402-agent-policy.test.ts`. It
covers disabled and unprovisioned wallets, cap exhaustion, recipient policy,
idempotency conflicts, unknown outcomes, terminal transitions, disabled
adapters, and provider exceptions.

## Phase 4: ERC-8004 Arena verification credentials

Phase 4 adds the validation-credential boundary in
`backend/src/agon/verification-credentials.ts`. A credential binds an Agon
listing version and manifest hash to a distinct ERC-8004 validator, an
immutable request URI/hash, and the latest validator response. Responses use
the ERC-8004 0-100 scale: `100` is verified, `0` is rejected, and intermediate
values remain pending. Older responses cannot overwrite newer evidence;
expired and revoked credentials are terminal.

The request payload is canonicalized and hashed before it can be submitted.
The ledger rejects self-validation, malformed registry/listing identifiers,
unsafe evidence URIs, invalid hashes, stale responses, validator mismatches,
and terminal-state mutations. Reusing a request hash with different evidence
is an explicit conflict.

`AGON_ARENA_VALIDATION_ENABLED` defaults to `false`. The default
ValidationRegistry adapter is disabled and performs no validator-wallet
construction, RPC request, signature, or transaction. The external ERC-8004
ValidationRegistry is a public anchor only until a distinct validator address,
durable credential persistence, evidence review policy, and an explicit
testnet transaction approval are all in place. This follows the ERC-8004 draft
interface, where the agent owner submits `validationRequest` and the selected
validator later submits `validationResponse`; the standard does not itself
provide validator incentives or slashing.

The adversarial suite is
`backend/test/agon/verification-credentials.test.ts`. It covers deterministic
hashing, self-validation refusal, idempotent requests, request conflicts,
progressive responses, stale evidence, expiry, revocation, and the disabled
adapter.

## Phase 5: escrow, syndicate pools, and prize-vault boundary

Phase 5 adds exact escrow terms and prize allocation in
`backend/src/agon/escrow-policy.ts`. Escrow is eligible only when the listing
is Listed, Verified, and explicitly uses the Escrow rail. Terms pin Arc
Testnet, the deployed USDC address, the listing version and manifest hash, the
buyer, the provider beneficiary, integer base-unit amount, capped fee, and a
future expiry.

Escrow intents use an idempotency key bound to the complete terms hash. The
state machine writes a prepared marker before any future provider call and
distinguishes funding, funded, release/refund pending, terminal completion,
failure, and unknown outcomes. Unknown outcomes cannot be retried as a new
funding call; they require an independent reconciliation result first.

Syndicate prize allocation uses integer basis points, rejects duplicate
beneficiaries and non-conserving weights, and assigns any division remainder
deterministically to the highest-ranked winner. The allocation result proves
that platform fee plus winner shares equal the original pool.

`AGON_ESCROW_ENABLED` and `AGON_SYNDICATE_PRIZE_POOL_ENABLED` default to
`false`, with the pool cap defaulting to zero. The default adapter is disabled
and performs no PrizeEscrow, Circle, RPC, USDC transfer, release, refund, or
claim operation. The deployed legacy `PrizeEscrow` and `SyndicateFactory`
contracts remain read-only/parallel until durable Agon persistence, controller
authorization, and release/refund reconciliation are separately approved.

The adversarial suite is `backend/test/agon/escrow-policy.test.ts`. It covers
escrow eligibility, exact terms, idempotency conflicts, guarded transitions,
unknown outcomes, payout conservation, remainder allocation, duplicate
winners, and the disabled adapter.

### Provider receipt source decision

Circle's documented Arc Testnet Gateway base is `https://gateway-api-testnet.circle.com`. The `POST /gateway/v1/x402/settle` response describes `transaction` as a **transfer UUID**, not an on-chain transaction hash. The corresponding read-only source is `GET /v1/x402/transfers/{id}` (or the paginated `GET /gateway/v1/x402/transfers` search endpoint), which returns the UUID, `status`, USDC amount, sender, recipient, CAIP-2 networks, and timestamps. Circle documents these transfer states as `received`, `batched`, `confirmed`, `completed`, and `failed`; `confirmed` means included onchain and `completed` means fully complete. The Gateway flow can serve a resource before batched onchain settlement, so a successful `settle` response is not finality evidence.

The read-only adapter contract now supports this UUID source and the durable receipt stores `providerTransferId` separately from `settlementRef`. The Circle adapter is wired behind `AGON_X402_RECONCILIATION_ENABLED`, which defaults to `false`. It binds the UUID to the exact intent, payer, recipient, amount, both Arc Testnet transfer networks, and `eip155:5042002`, applies bounded timeouts, a 64 KiB response cap, and a circuit breaker, and maps Circle's pending/confirmed/failed states without claiming service delivery. Reconciliation readiness distinguishes `lookup_disabled`, `lookup_required`, `reference_required`, and `terminal`; `lookupEnabled` reports the actual server-side adapter state while execution remains disabled. Production remains disabled by default and makes no provider request unless a controlled testnet configuration explicitly enables the flag.

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
