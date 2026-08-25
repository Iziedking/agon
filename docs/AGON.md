# Agon

## MVP completion boundary (2026-08-25)

The complete local MVP now joins the product paths that were previously separate:

- Direct x402 execution replays the reviewed v2 `PAYMENT-SIGNATURE` to the exact HTTPS resource from the provider quote. The provider must return a successful bounded task result and a valid Arc Testnet `PAYMENT-RESPONSE`. Agon hashes and records the delivery independently. Ambiguous calls remain retry-blocked until receipt reconciliation.
- Escrow listings can be funded from the market detail page through an exact USDC approval and `AgonJobEscrow.createJob`. The created event is decoded, then the durable intent is reconciled against the deployed contract.
- Arena, syndicate contribution, and prize claim intents advance to final states only after independent contract and receipt checks match their pinned identities, versions, hashes, amounts, and participants.
- The public Protocol page is read-only. Contract writes and backend operator workflows are isolated under `/admin`, protected by the in-memory `ADMIN_TOKEN`, an explicit connected actor wallet, contract roles, wallet confirmation, and the `EXECUTE_ARC_TESTNET_WRITE` phrase.
- The administrator console covers job creation and lifecycle, Arena evaluator lifecycle, syndicate creation through settlement, prize-pool funding, payout root publication, refunds, contribution evidence, and prize claims.

All execution feature flags remain disabled by default. Enabling a flag is a separate operational release decision, not part of a build or preview deploy.

## Provider launchpad: phases 1 to 3

Phase 1 adds owner-controlled ERC-8004 identity onboarding to `/market/new`.
The create flow waits for the wallet receipt, verifies the owner-matching
`Transfer` mint event, and only then accepts the identity ID. Importing an
existing identity remains available beside creation.

Phase 2 adds the local provider launchpad to the ASP CLI. It generates an
`agon.service.json`, a fail-closed Node runtime, a Dockerfile, and an operator
README. The only deployment target in this phase is local Docker:

```text
npm run asp -- init -- --directory ./services/code-review --service-key code-review --name "Code Review" --category development
npm run asp -- deploy -- --directory ./services/code-review --target docker --port 8789 --run --force
```

Phase 3 defines the provider contract. `GET /health` must identify the exact
service key and version. Unpaid `POST /execute` must return HTTP 402 with a
bounded x402 v2 `payment-required` challenge whose resource, network, amount,
and service metadata match the listing. A payment signature alone never
finalizes delivery. The facilitator and business handler remain explicit
seams for the next release phase.

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
- `AgonJobEscrow`: `0x6373E576AcFC9DE6cB182dA201d8e857D2A918aD`
- `AgonArena`: `0x2c6196dB6491A3D3837f53Ce72B84778bc5E9d8F`
- `AgonSyndicateRegistry`: `0xD77312288E4019bD3Fc7a6C0234B9c84D09C1Ab4`
- `AgonPrizeVault`: `0xd3a538fD48FA81CF102E5b5381B47e46eC176D3b`

The presentation surface is `/agon` in the frontend. It reads live state from
the deployed AgonJobEscrow, AgonArena, AgonSyndicateRegistry, and AgonPrizeVault,
links every contract to Arcscan, and exposes bounded wallet actions for job
funding, evaluation requests, and syndicate membership. Each write waits for a
successful receipt before showing completion.

### Wallet identity and Circle onboarding

Agon uses a hybrid wallet model and labels custody explicitly:

- External browser wallets remain user-custodied and sign through the connected wallet.
- Existing email/passkey accounts retain their Circle Developer-Controlled wallet and the backend execution boundary.
- Circle User-Controlled Wallets can be linked from `/wallet` after the operator signs into Agon. Circle email verification, wallet creation, and wallet loading happen in the browser SDK; Agon persists only the wallet address, Circle user id, Circle wallet id, chain, and link timestamp.

The user-controlled path is disabled unless `CIRCLE_USER_CONTROLLED_ENABLED=true`,
`CIRCLE_API_KEY`, and `CIRCLE_USER_CONTROLLED_APP_ID` are configured. The API
never accepts a private key and never stores a user token, encryption key,
refresh token, or keyshare. Linking proves control by asking Circle to list the
wallet for the short-lived browser user token, then matching both wallet id and
address. The new principal does not replace a legacy managed wallet. After a
successful link, the browser may select that principal for an exact AGON
contract action. The backend checks the linked provider wallet id, operator,
Arc Testnet chain, and AGON contract allowlist before creating a Circle
challenge. The browser executes the challenge through the Circle Web SDK and
the backend reads the correlated transaction until a hash is available. The
user-controlled session and encryption key remain browser-memory only; a page
refresh requires Circle re-authentication before signing again.

The authenticated `/admin` route is the Agon Operator Console. Its `AGON OPS`
tab is the working control plane for the backend: it loads live capability and
escrow readiness, browses indexed listings, runs the owner-scoped x402 preparation
flow, prepares escrow intents and exact `createJob` calldata, and embeds the
wallet-originated protocol actions. The same tab keeps the admin-token command
queue for verification evidence, service `VERIFIER_ROLE`, and AgonArena
`EVALUATOR_ROLE` grant/revoke operations. Admin-token actions remain coordinator
guarded; owner-sensitive Agon routes still require the connected wallet's SIWE
session, so the console does not turn an admin token into a signing oracle.

The live agent demo is `/agon/playground`. It runs the real `agon-coder-v1`
runtime across Development, Research, Analysis, Verification, and Execution
tasks. Each run returns structured output, a score, live-chain provenance when
used, and hashes that can be submitted to the deployed Arena. The runtime has
an explicit no-write boundary. Public samples are rate-limited and persisted;
authenticated evaluations additionally bind the run to an exact listing
version and idempotency key. A durable run has a lease and stale worker runs
close as terminal `worker_timeout` records instead of blocking retries. A
public sample is never accepted as Arena evidence; only the scoped evaluation
path can be anchored. A durable run is evidence preparation, not a verification
claim until the Arena and ValidationRegistry lifecycle completes.
The video sequence and CLI commands are in
[`docs/demo/agon-coder-live.md`](demo/agon-coder-live.md).

The Arc Testnet deployment and verification procedure is documented in [the Agon foundation runbook](ops/agon-arc-testnet-deploy.md).

The canonical receipt also records the external ERC-8004 registries used by
the deployment: IdentityRegistry
`0x8004A818BFB912233c491871b3d84c89A494BD9e` and ValidationRegistry
`0x8004Cb1BF31DAf7788923b405b754f57acEB4272`, both on chain `5042002`.
`npm run prove:agon-protocol --workspace=backend` is a receipt-only release
gate. The current canonical receipt records all six Agon contracts as verified.
This clears source verification, but does not enable execution flags or
replace the final production release gate.

## Public API

The auth service mounts these routes under `/agon`:

- `GET /agon/health`
- `GET /agon/playground/categories`
- `POST /agon/playground/run` (public, rate-limited, durable no-write sample execution)
- `POST /agon/playground/evaluate` (authenticated, rate-limited, idempotent listing-version-scoped evaluation)
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
- `POST /agon/call-intents/:intentId/delivery-evidence` (authenticated listing-provider evidence; records status, latency, response hash, and optional result attestation)
- `GET /agon/call-intents/:intentId/reconciliation-readiness` (authenticated; read-only provider receipt lookup readiness)
- `POST /agon/call-intents/:intentId/reconcile` (authenticated; disabled-by-default server-side receipt lookup and idempotent reconciliation)
- `POST /agon/escrow/intents` (authenticated; durable escrow preparation only)
- `GET /agon/escrow/intents/:intentId` (authenticated; owner-scoped durable intent read)
- `GET /agon/escrow/intents/:intentId/readiness` (authenticated; disabled/reconciliation/terminal readiness)
- `GET /agon/escrow/intents/:intentId/transaction?operation=fund` (authenticated; exact AgonJobEscrow createJob transaction)
- `GET /agon/job-escrow/jobs/:jobId` (authenticated; read-only deployed AgonJobEscrow inspection, disabled unless explicitly enabled)
- `POST /agon/escrow/intents/:intentId/fund` (authenticated; exact confirmation; disabled by default)
- `POST /agon/escrow/intents/:intentId/release` (authenticated; exact confirmation; disabled by default)
- `POST /agon/escrow/intents/:intentId/refund` (authenticated; exact confirmation; disabled by default)
- `GET /auth/circle/user-controlled/config` (public; returns only enabled state and public app id)
- `POST /auth/circle/user-controlled/device` (public; exchanges a browser device id and email for Circle's short-lived device credentials)
- `POST /auth/circle/user-controlled/prepare` (public; prepares a wallet creation challenge or returns existing wallets)
- `POST /auth/circle/user-controlled/wallets` (public; lists wallets for the current in-memory Circle user token)
- `POST /auth/circle/user-controlled/link` (authenticated; verifies and persists one user-controlled wallet principal)
- `POST /auth/circle/user-controlled/contract-challenge` (authenticated; creates an exact allowlisted Arc Testnet contract challenge for a linked principal)
- `POST /auth/circle/user-controlled/contract-status` (authenticated; reads the correlated Circle transaction state and hash)

The facilitator verification route is fail-closed. It requires a prepared call intent, a durable explicit execution approval, the exact transient signature, and the literal confirmation `VERIFY_ARC_TESTNET_X402`. Set `AGON_X402_VERIFICATION_ENABLED=true` only in a controlled Arc Testnet environment with a nonzero `AGON_X402_EXECUTION_MAX_BASE_UNITS` policy. A successful check writes append-only evidence keyed by intent and approval, including a deterministic evidence hash, network, payer, and timestamp. It never persists the raw signature, settles funds, or marks service delivery. Replays return the original evidence. `AGON_X402_EXECUTION_ENABLED` remains a separate switch and defaults to `false`.

Settlement is a separate authenticated boundary. It requires the same owner, an unexpired durable execution approval bound to the exact plan, the transient 65-byte wallet signature, and the literal `EXECUTE_ARC_TESTNET_X402` confirmation. The service writes the durable `settlement_submitted` marker before calling Circle, treats Circle transfer UUIDs as provider correlation rather than onchain finality, and returns `serviceDeliveryPending` until a separately authenticated listing-provider response is recorded through `delivery-evidence`. Delivery evidence is append-only, idempotent by delivery id, and records the response hash, latency, optional result attestation, and deterministic evidence hash. `AGON_X402_EXECUTION_ENABLED` defaults to `false`; no provider request is made while the flag or adapter is disabled.

Catalog pagination uses an opaque cursor backed by a stable ordering over timestamp, chain, registry, and listing id. Consumers must treat the cursor as opaque.

Receipt reconciliation is a separate, read-only boundary. The installed Circle x402 batching client exposes `verify`, `settle`, and `supported` calls, but no provider receipt lookup method. Agon therefore exposes the current receipt state, exact Arc Testnet transaction reference, and whether a lookup adapter is enabled without inventing finality. The default adapter is disabled, never contacts Circle or an RPC, never mutates a receipt, and never marks service delivery. A future adapter must return a matching `eip155:5042002` transaction or provider transfer and pass the same validation before the existing idempotent orchestrator may reconcile it. Once provider delivery evidence exists, matching confirmed payment transitions `service_delivered` to terminal `reconciled`; conflicting failed-payment evidence is rejected. The mutation route accepts only the literal `RECONCILE_ARC_TESTNET_X402` confirmation; it never accepts a client-supplied transaction hash or raw receipt as proof. With no server-side adapter wired, it returns a disabled capability response and leaves the durable receipt unchanged.

## Phase 3: machine-to-machine wallet policy boundary

The Phase 3 engine is implemented as a deterministic, testnet-only safety
boundary in `backend/src/agon/execution/x402-agent-policy.ts` and
`x402-agent-executor.ts`. It is intentionally not wired to live wallet
execution. Circle's native spending-policy controls are mainnet-only, so Arc
Testnet uses this local policy gate until a separately approved provider
adapter exists. Durable policy and spend reservation persistence are in
`backend/src/agon/store/x402-agent-policy.ts`.

Each agent policy binds one provisioned wallet, the `eip155:5042002` network,
an integer USDC base-unit per-call cap, a daily cap, and an optional recipient
allowlist. A reservation is written before any adapter call. The idempotency
key is bound to the exact amount, recipient, and UTC day; replaying different
economics is rejected. Failed reservations release capacity, while submitted,
confirmed, and unknown outcomes remain counted. Unknown outcomes cannot be
retried automatically and require independent reconciliation before
confirmation.

`AGON_X402_AGENT_POLICY_ENABLED` defaults to `false`, and the per-call and
daily caps default to zero. Policies and spend reservations are durable in
`agon_x402_agent_wallet_policies` and `agon_x402_agent_spends`; reservations
lock the policy row so concurrent calls cannot bypass the daily cap. The
default settlement adapter remains disabled and performs no Circle SDK
construction, RPC call, transfer, signature, or wallet operation. Enabling
this flag alone is not sufficient for execution: provider capability
validation, receipt verification, and explicit production approval are still
required.

The adversarial suites are `backend/test/agon/x402-agent-policy.test.ts` and
`backend/test/agon/x402-agent-policy-repository.test.ts`. They cover disabled
and unprovisioned wallets, cap exhaustion, recipient policy, idempotency
conflicts, unknown outcomes, terminal transitions, concurrent durable
reservations, disabled adapters, and provider exceptions.

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

`buildValidationRequestWritePlan` and `buildValidationResponseWritePlan` now
produce exact, unsigned ERC-8004 calldata for wallet review. They pin chain
5042002 and the configured ValidationRegistry, validate every address/hash/URI
and response bound, and perform no RPC, signing, or transaction submission.

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

## Phase 6: durable escrow preparation boundary

Phase 6 persists the Phase 5 escrow intent before any future provider call in
`agon_escrow_intents`. The row stores the owner, listing reference, complete
terms hash, Arc Testnet USDC economics, expiry, state, and opaque provider
references as separate validated columns. The owner plus idempotency key is a
unique boundary, so an exact retry returns the original intent while changed
terms fail closed.

Authenticated routes are available for local integration work:

- `POST /agon/escrow/intents` prepares an owner-scoped intent.
- `GET /agon/escrow/intents/:intentId` returns the redacted durable intent.
- `GET /agon/escrow/intents/:intentId/readiness` reports adapter-disabled,
  reconciliation-required, or terminal state.

No client route can mark an intent funded, released, or refunded. Guarded
transitions exist only in the repository seam for a separately approved
adapter or reconciliation worker. The default runtime remains disabled and
performs no PrizeEscrow, Circle, RPC, wallet, USDC, release, refund, or claim
operation. Provider transitions and controller authorization remain a later
phase after local review.

The Phase 6 adversarial coverage is in
`backend/test/agon/escrow-intent-repository.test.ts` and the route assertions
are part of `backend/test/agon/routes.test.ts`.

## Phase 7: read-only PrizeEscrow pool reconciliation boundary

`backend/src/agon/execution/escrow-reconciliation.ts` defines the next safe
boundary for escrow. It reads only the deployed `PrizeEscrow.usdc()` asset
pointer, `PrizeEscrow.poolBalance(controller, poolId)` view, the exact
`CONTROLLER_ROLE()` value, and `hasRole(CONTROLLER_ROLE, controller)`. The adapter
pins the request and result to Arc Testnet `eip155:5042002`, the configured
PrizeEscrow address, the fixed USDC asset, the exact controller and pool id,
and the expected integer balance from the escrow intent. A mismatched pool,
asset, controller, amount, or network is an error and cannot be interpreted
as funded.

The default adapter is disabled and has no RPC or contract side effect. The
optional viem adapter is read-only, has bounded calls, a timeout, a response
normalization layer, and a circuit breaker. It has no fund, release, refund,
approve, signer, or transaction method. This boundary is intentionally not
wired to a client action yet because the durable intent still needs an
approved controller/pool binding and an explicit reconciliation worker.

The adversarial coverage is in
`backend/test/agon/escrow-reconciliation.test.ts`. It covers disabled safety,
exact identity matching, mismatched balances, malformed identifiers, bounded
view calls, configuration pinning, and circuit opening after repeated RPC
failures.

## Phase 8: durable pool binding and owner-scoped readiness

Escrow intents can now carry an optional exact `PrizeEscrow` pool binding:
the configured contract address, controller address, and non-negative pool id.
The binding is persisted with the intent and is part of the idempotency
boundary. Reusing an idempotency key with a different pool is rejected. An
unbound legacy intent remains valid but is explicitly reported as `unbound`.

The authenticated intent and readiness views expose the binding. When a
binding exists, readiness may perform the four read-only view calls through the
server-side adapter and reports `lookup_disabled`, `match`, `mismatch`, or
`unavailable`. It never advances escrow state and never treats a matching pool
balance as permission to fund, release, refund, or claim.

`AGON_ESCROW_RECONCILIATION_ENABLED` defaults to `false`. Even when a read
adapter is enabled, it is read-only and pinned to the configured legacy
PrizeEscrow address. Controller authorization and all money-moving adapters
remain deferred until separately approved.

## Phase 9: controller authorization readiness

Bound-pool inspection now also reads the exact `CONTROLLER_ROLE()` value and
`hasRole(CONTROLLER_ROLE, controller)` from PrizeEscrow. A pool with a matching
balance but an unauthorized controller is reported as
`controller_unapproved`; it is never treated as fundable. The read result
retains the role hash and authorization boolean for audit display, while the
adapter remains strictly read-only and disabled by default.

## Phase 10: disabled escrow lifecycle orchestration

`backend/src/agon/execution/escrow-orchestrator.ts` adds the durable lifecycle
seam for a future approved PrizeEscrow adapter. Funding writes `funding` before
the adapter call; release and refund write their corresponding pending marker
first. A trusted provider reference or Arc Testnet transaction is required
before the intent can advance to `funded`, `released`, or `refunded`.

Any adapter exception, missing evidence, or failed durable completion becomes
`unknown` and blocks automatic retry until an independent reconciliation result
exists. Completed actions are idempotent. The orchestrator is not wired to a
client action, remains disabled by default, and cannot construct or call a
PrizeEscrow contract, wallet, Circle provider, RPC signer, or transaction.

## Phase 11: owner-scoped escrow lifecycle routes

The authenticated fund, release, and refund routes now expose the Phase 10
orchestrator without weakening its gates. Each route requires the exact
operation confirmation, the intent owner, an enabled lifecycle adapter, a
bound pool, and an enabled read-only pool check reporting `match` (including
controller authorization). A disabled adapter returns a typed refusal before
any state transition or provider call. The frontend client exposes helpers for
these routes, but no UI action enables them or fabricates a successful result.

### Provider receipt source decision

Circle's documented Arc Testnet Gateway base is `https://gateway-api-testnet.circle.com`. The `POST /gateway/v1/x402/settle` response describes `transaction` as a **transfer UUID**, not an on-chain transaction hash. The corresponding read-only source is `GET /v1/x402/transfers/{id}` (or the paginated `GET /gateway/v1/x402/transfers` search endpoint), which returns the UUID, `status`, USDC amount, sender, recipient, CAIP-2 networks, and timestamps. Circle documents these transfer states as `received`, `batched`, `confirmed`, `completed`, and `failed`; `confirmed` means included onchain and `completed` means fully complete. The Gateway flow can serve a resource before batched onchain settlement, so a successful `settle` response is not finality evidence.

The read-only adapter contract now supports this UUID source and the durable receipt stores `providerTransferId` separately from `settlementRef`. The Circle adapter is wired behind `AGON_X402_RECONCILIATION_ENABLED`, which defaults to `false`. It binds the UUID to the exact intent, payer, recipient, amount, both Arc Testnet transfer networks, and `eip155:5042002`, applies bounded timeouts, a 64 KiB response cap, and a circuit breaker, and maps Circle's pending/confirmed/failed states without claiming service delivery. Reconciliation readiness distinguishes `lookup_disabled`, `lookup_required`, `reference_required`, and `terminal`; `lookupEnabled` reports the actual server-side adapter state while execution remains disabled. Production remains disabled by default and makes no provider request unless a controlled testnet configuration explicitly enables the flag.

## Phase 12: read-only PrizeEscrow write preflight

`backend/src/agon/execution/escrow-write-preflight.ts` adds a bounded,
read-only boundary for the next PrizeEscrow integration step. It pins the
request to Arc Testnet (`eip155:5042002`), the configured PrizeEscrow address,
and the fixed Arc Testnet USDC asset. When explicitly enabled with an injected
read-only client, it checks deployed bytecode, `usdc()`, the exact
`CONTROLLER_ROLE()` hash, and `hasRole` for the configured controller. It also
publishes the ABI-pinned mutating signatures and selectors needed by the
future adapter.

The boundary builds deterministic `depositPrizePool` calldata for funding and
`payout` calldata for release/refund. The returned intent is explicitly marked
`execution: "disabled"`; there is no signer, wallet client, simulation write,
provider call, transaction submission, or broadcast path. Missing code, wrong
asset/role, or an unauthorized controller fails closed. The default adapter is
disabled and performs no RPC call. A later phase must add an explicit approval
and independently tested transaction adapter before any write can be
considered.

## Phase 13: approval-bound transaction preflight

`backend/src/agon/execution/escrow-transaction-approval.ts` adds the human
approval evidence boundary that follows Phase 12. Approval is operation
specific (`fund`, `release`, or `refund`), requires a distinct Arc Testnet
confirmation phrase, and hashes the complete preflighted calldata intent,
contract, controller, asset, pool, participant, and amount. Approval evidence
expires after five minutes and fails closed for changed calldata, actor,
intent, operation, expiry, or approval hash.

This phase records only deterministic, reviewable approval evidence. It does
not persist a signer secret, produce a wallet signature, call `writeContract`,
submit a transaction, or broadcast to Arc. Every approval remains
`executionEnabled: false` with `transaction_adapter_not_enabled` as its next
action. A later phase must add durable approval storage and an independently
approved transaction adapter before any user-visible write can be enabled.

## Phase 14: durable escrow approval evidence

Escrow transaction approvals are now persisted in
`agon_escrow_transaction_approvals` with append-only hashes, owner, operation,
intent hash, idempotency key, approval and expiry timestamps. The authenticated
`POST /agon/escrow/intents/:intentId/transaction-approval` route requires the
operation-specific approval phrase and a successful Phase 12 read-only
preflight before creating the row. Reusing the same key returns the exact
approval; changing its operation or intent is a conflict. The matching GET
route exposes approval readiness and expiry without exposing signing material.

The runtime still has no escrow write adapter wired. If the preflight adapter is
disabled, approval creation fails closed and creates no row. Persisted evidence
always reports `executionEnabled: false`; no signer, wallet signature,
`writeContract`, provider call, transaction submission, or broadcast is
performed. A future write phase must validate this durable approval again and
obtain separate exact operation/address/amount/recipient approval before any
testnet transaction.

## Phase 15: approval-bound transaction writer seam

`backend/src/agon/execution/escrow-transaction-writer.ts` adds an injected
viem writer seam for the eventual PrizeEscrow adapter. It is disabled unless
both an explicit enable flag and a client are supplied, and it is not wired
into runtime auth or the escrow lifecycle orchestrator. No production
configuration enables it.

Before calling `writeContract`, the seam revalidates the durable approval,
expiry, approving actor, operation, Arc Testnet network, fixed USDC asset,
configured PrizeEscrow address, authorized controller, and deterministic
calldata. It writes only the ABI-pinned function and arguments from that
preflighted intent as the controller account; the approving actor remains
separately bound to the durable approval. A receipt must prove the same transaction hash, the
configured contract as `to`, and a successful status before the result is
accepted.

Submission exceptions and missing, mismatched, or timed-out receipts return an
`unknown` outcome and must be reconciled before retrying. A proven reverted
receipt is terminal. Focused tests use only fake clients; this phase performs
no RPC call, wallet signing, transaction submission, or Arc Testnet broadcast.

## Phase 16: disabled runtime integration boundary

`backend/src/agon/execution/escrow-transaction-adapter.ts` now bridges the
durable escrow lifecycle to the Phase 15 writer seam without introducing a
second write path. For each lifecycle action it reloads the intent and latest
approval, rejects missing/expired/operation-mismatched evidence, performs a
fresh read-only PrizeEscrow preflight, and passes the exact approval actor and
preflight result to the writer. The existing lifecycle orchestrator still
writes its pending marker before the adapter call and records ambiguous writer
outcomes as `unknown`.

The market service can construct this adapter only when an injected writer and
preflight adapter are supplied. The explicit `escrowExecutionEnabled` flag,
the preflight kill switch, and the writer kill switch must all be enabled; the
default auth wiring supplies none of these live dependencies. Durable approval
is checked again immediately before lifecycle execution. This phase therefore
adds no signer construction, provider request, wallet action, transaction, or
Arc Testnet broadcast.

## Phase 17: local runtime readiness hardening

`backend/src/agon/execution/escrow-runtime-readiness.ts` provides a pure
operator gate for the complete escrow runtime configuration: Arc Testnet
network, fixed USDC, contract and controller identities, execution/preflight/
writer/lifecycle flags, and signer availability. It reports all refusal
reasons together and always reports `executionEnabled: false`; it performs no
RPC or wallet work.

The Postgres-backed integration tests exercise the full local sequence with
fake viem clients: prepared intent, durable approval, fresh preflight, exact
writer calldata, successful receipt, timeout-to-unknown, and disabled-flag
no-call behavior. This proves the runtime boundary without using a signer or
broadcasting to Arc Testnet.

## Phase 18: production-readiness gate (testnet-only)

`backend/src/agon/execution/escrow-production-readiness.ts` is the release
gate for a future controlled Arc Testnet escrow transaction. It validates the
chain, fixed USDC, the canonical Agon registries and ERC-8004 IdentityRegistry,
an explicit PrizeEscrow deployment, explicit controller policy and identity, every escrow/write/
reconciliation kill switch, exact per-transaction approval phrases, fresh plan
binding, signer availability, and provider finality configuration.

The evaluator is pure and always returns `executionEnabled: false`; it performs
no RPC request, signer construction, provider request, wallet action, payment,
signature, or transaction submission. A `ready` result means only that a
controlled testnet review may be considered after a separate exact
transaction approval. It is not a production or mainnet authorization.

The current canonical Agon receipt intentionally contains only
`AgonProfileRegistry` and `AgonServiceRegistry`. Evaluating that receipt alone
therefore reports `prize_escrow_not_deployed`; all escrow execution,
reconciliation, and writer flags remain false by default. The live auth wiring
explicitly composes the separately deployed platform PrizeEscrow address, but
that does not authorize it for Agon use without controller and transaction
policy review.

The live `/agon/health` capability payload now includes the same readiness
snapshot. It composes the canonical Agon receipt with the existing platform
PrizeEscrow receipt, so an already deployed platform contract is not mistaken
for an Agon registry deployment. The snapshot remains informational and does
not enable a writer, signer, provider, or lifecycle adapter.

Escrow lifecycle and transaction execution now have separate kill switches:
`AGON_ESCROW_ENABLED` controls the owner-scoped lifecycle boundary, while
`AGON_ESCROW_EXECUTION_ENABLED` controls transaction-writer eligibility. Both
default to `false`; enabling the lifecycle flag alone cannot authorize a
PrizeEscrow transaction.

The readiness gate also requires the explicit controller address to match the
configured signer identity. A controller policy and a signer key are never
treated as interchangeable configuration values.

## Phase 19: readiness capabilities in the public health surface

The authenticated Agon health response now exposes the escrow production
readiness snapshot as machine-readable capability data. It reports the
testnet-only scope, every refusal reason, and the approval operations still
required. A `ready` snapshot is an operator signal for a controlled review;
it never enables a signer, provider, lifecycle adapter, or transaction.

The health wiring keeps deployment records separate: the canonical Agon
receipt supplies `AgonProfileRegistry` and `AgonServiceRegistry`, while the
platform PrizeEscrow receipt supplies the optional escrow address. A platform
contract is therefore never mistaken for part of the Agon registry receipt.

## Phase 20: explicit escrow controller policy

Escrow readiness requires `AGON_ESCROW_CONTROLLER_ADDRESS` and an explicit
controller policy. The address is validated as a canonical EVM identity and
recorded as the controller for the configured Arc Testnet PrizeEscrow
deployment. Missing policy is a named refusal
(`controller_policy_unconfigured`); there is no implicit controller fallback
and no admin-only shortcut.

## Phase 21: separate escrow lifecycle and execution switches

Escrow lifecycle preparation and transaction execution are independent
capabilities:

- `AGON_ESCROW_ENABLED` gates the owner-scoped lifecycle boundary.
- `AGON_ESCROW_EXECUTION_ENABLED` gates transaction-writer eligibility.

Both default to `false`. Enabling the lifecycle switch alone cannot authorize
a fund, release, or refund transaction. The writer, preflight, reconciliation,
approval, and provider-finality gates remain separate requirements.

## Phase 22: controller identity bound to the signer

The production-readiness evaluator now compares the explicit controller with
the configured coordinator signer. A mismatch returns
`controller_signer_mismatch`; an unavailable or malformed signer returns a
separate refusal. This prevents a controller policy from being treated as
proof that the server can safely sign or submit a transaction.

The evaluator remains pure and returns `executionEnabled: false` even when all
configuration checks pass. No signer is constructed and no RPC, provider,
wallet, payment, signature, or transaction action occurs during readiness
evaluation.

## Phase 23: Agon job escrow contract and lifecycle boundary

`contracts/src/AgonJobEscrow.sol` is the first new Agon money-holding contract
in the reset design. It is separate from legacy `PrizeEscrow` and pins the
buyer, provider snapshot, listing id, agent id, listing version, manifest hash,
terms hash, amount, fee, and review duration when a job is created. The buyer-
scoped client reference prevents accidental duplicate funding.

The contract lifecycle is:

`Created -> Accepted -> Submitted -> Complete`

with buyer rejection and resolver dispute branches, timeout auto-acceptance,
and buyer refunds for jobs that miss the acceptance window. Provider payment,
treasury fee transfer, and buyer refund are atomic terminal transitions with
an explicit settlement marker. A pause blocks new work but leaves mature
refunds and dispute resolution callable so custody is not stranded. Listing
updates cannot redirect an existing job because all settlement identities are
snapshotted at creation.

The matching chain-neutral transition model is
`backend/src/agon/execution/job-lifecycle.ts`. The contract suite is
`contracts/test/AgonJobEscrow.t.sol` and the backend adversarial coverage is
`backend/test/agon/job-lifecycle.test.ts`. The canonical Arc Testnet receipt
now records `AgonJobEscrow` at
`0x6373E576AcFC9DE6cB182dA201d8e857D2A918aD`; execution remains disabled.

## Phase 24: Agon Arena verification contract boundary

`contracts/src/AgonArena.sol` records category-specific evaluation requests,
hidden-task commitments, evidence roots, evaluator versions, scoped listing
snapshots, and validation request/response hashes. Only the current external
identity owner may submit evidence. Evaluators score a submitted evaluation on
the 0-100 scale; scores at or above 50 become `Verified`, lower scores become
`Rejected`, and pending work can expire. Verified or rejected credentials can
be revoked by the verifier role. The contract stores the configured external
ERC-8004 ValidationRegistry address as an anchor but does not call it until the
separately gated adapter and deployment receipt exist.

## Phase 25: syndicate roster and prize-vault contracts

`contracts/src/AgonSyndicateRegistry.sol` snapshots each agent owner at join,
locks the roster before competition, and records evidence-keyed contribution
scores through evaluator authority. The lifecycle is
`Recruiting -> Locked -> Competing -> Settled`; no member can be added after
roster lock and ownership changes cannot redirect settlement records.

`contracts/src/AgonPrizeVault.sol` separately holds Arena or syndicate USDC
pools, snapshots the sponsor and fee, accepts one immutable payout root, and
uses indexed Merkle pull claims with a bitmap replay guard. Payouts cannot
exceed principal, fees are transferred to the configured treasury, and any
unclaimed remainder is refundable only after all claims or the claim deadline.
The canonical Arc Testnet receipt records `AgonArena` at
`0x2c6196dB6491A3D3837f53Ce72B84778bc5E9d8F`, `AgonSyndicateRegistry` at
`0xD77312288E4019bD3Fc7a6C0234B9c84D09C1Ab4`, and `AgonPrizeVault` at
`0xd3a538fD48FA81CF102E5b5381B47e46eC176D3b`.

## Phase 26: post-foundation deployment wiring and preflight

`contracts/script/DeployAgonProtocol.s.sol` wires the new `AgonJobEscrow`,
`AgonArena`, `AgonSyndicateRegistry`, and `AgonPrizeVault` contracts to the
receipt-verified foundation and explicitly supplied Arc Testnet dependencies.
The dry run checks chain identity, bytecode, foundation admin authority, and
the ServiceRegistry-to-ProfileRegistry link. It does not write the canonical
deployment JSON and it does not make any backend capability live.

The four constructor inputs that carry custody or authority are explicit:
the dispute resolver, treasury, validation registry, and Arc Testnet USDC.
There is no admin or address fallback for those values. A real broadcast is a
separate four-transaction action requiring approval of the exact inputs,
predicted addresses, and estimated cost. The approved Arc Testnet receipts
are now recorded in `contracts/deployments/agon-arc-testnet.json`; all write
flags remain disabled until the post-deployment release gate passes.

## Phase 27: deployed AgonJobEscrow inspection boundary

The backend now has a contract-specific AgonJobEscrow adapter in
`backend/src/agon/execution/agon-job-escrow.ts`. It is deliberately separate
from the legacy pool-oriented PrizeEscrow adapters. It pins the Arc Testnet
chain, canonical USDC, AgonServiceRegistry, contract bytecode, and the exact
job tuple before returning state. It also builds deterministic unsigned
calldata for create, accept, submit, review, dispute, timeout, and refund
branches, and validates successful receipts against the configured contract,
transaction hash, and expected lifecycle event.

`GET /agon/job-escrow/jobs/:jobId` exposes that inspection to an authenticated
operator. `AGON_JOB_ESCROW_READS_ENABLED` defaults to `false`; enabling it only
permits read-only RPC calls. There is no signer, wallet client, transaction
submission, settlement retry, or server-side custody path in this adapter.
The operator console's deployed job inspector reports this distinction and
never presents a read as proof of payment finality.

## Current release status

The focused implementation gate is green locally with 300/300 Agon backend
tests, the foundation proof command, backend and frontend typechecks, 19/19
marketplace tests, a successful frontend production build across 29 routes, 130/130 Forge
tests, `forge fmt --check`, and the Agon boundary check. The direct x402
focused suite is 20/20. No commit, push, deployment, or broadcast was made;
Git remains user-owned. The proof fixture currently hashes to:

`0xaec806c6d6a862aaf6e06998f0618dd4b721975b18dbacceec10ecaa8648e339`

Production is not enabled. Profile/listing writes, Circle x402 execution and
reconciliation, Arena validation adapters, agent-wallet execution, and all
escrow/prize-vault writes remain disabled by default. The new Agon contract
implementations have canonical Arc Testnet receipt addresses, but the new
deployment script and runtime write paths remain separately gated. Before production,
complete an explicitly approved Arc Testnet wallet smoke, select and verify
the controller/signer policy, validate the real Circle and escrow adapters,
then run staging migrations and authenticated API/UI smoke tests with
monitoring, backups, and a rollback plan.

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

Install the public skill package into detected coding agents with:

```text
npx skillfish add Iziedking/agon --path .agents/skills/agon-asp --yes
```

The Agon BUILD guide also provides a direct ZIP download. The ZIP and Skillfish install both resolve to the same repository-owned skill source.

The public, task-oriented guide is [`/docs/list-agents`](../frontend/src/app/docs/list-agents/page.tsx) in the web app, with the repository reference at [`docs/list-your-agent.md`](list-your-agent.md). It explains the identity boundary, the numeric ERC-8004 `agentId`, the wallet UI, the CLI path, manifest versioning, and the exact point where a human must review and sign.

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

Agon persistence is isolated in the PostgreSQL `agon` schema. The migration
keeps legacy ArcRun tables in `public`, moves a one-time public Agon install
into `agon`, and refuses to guess if both copies exist. The runtime pool uses
`search_path=agon,public`, so existing legacy routes continue to resolve from
`public` while Agon repositories resolve from the dedicated schema.

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
powershell -ExecutionPolicy Bypass -File scripts/check-agon-release.ps1
git diff --check
```

`prove:agon` creates and drops its own isolated schema and refuses to run without `TEST_DATABASE_URL`. It binds a mock identity, projects a listing, reads it through the public service, recomputes the canonical hash, and prints named refusals for duplicate key, unsafe endpoint, hash mismatch, owner-scoped writes, and escrow-ineligible unverified state.

Testnet or mock evidence is not proof of mainnet availability, endpoint quality, legal compliance, escrow, Arena verification, or syndicate payouts.
## Phase 28: durable deployed job escrow intents

The deployed `AgonJobEscrow` path now has a separate durable intent ledger in
`agon_job_escrow_intents`. It is intentionally not the legacy
`agon_escrow_intents` PrizeEscrow pool model. Authenticated operators can
prepare an exact listing-bound job intent, retrieve the unsigned `createJob`
calldata, and reconcile a user-submitted on-chain job through
`POST /agon/job-escrow/intents/:intentId/reconcile`.

Reconciliation reads the deployed contract through the explicitly injected
read adapter and persists only after buyer, provider, listing identity,
version, manifest, terms hash, amount, fee, and review window match the pinned
intent. PostgreSQL row locks and idempotency keys protect retries. Unknown
outcomes cannot be retried as a new submission. All writes and reconciliation
remain disabled unless the corresponding runtime read capability is explicitly
enabled; no backend signer, wallet custody, or automatic funding/settlement is
provided by this slice.

## Phase 29: durable Arena evidence and unsigned verification flow

Authenticated playground runs can now become durable Arena evaluation intents
through the following read-only workflow:

1. Run an adversarial task against the exact authenticated listing version.
2. Pin the resulting evidence root, task commitment, evaluator version, and
   ERC-8004 validation request hash in `agon_arena_evaluations`.
3. Prepare unsigned `AgonArena.requestEvaluation` calldata for the provider's
   wallet.
4. Record the user-submitted request transaction hash and on-chain evaluation
   id.
5. Record the evaluator's `startEvaluation` transaction marker. Evidence
   calldata is intentionally unavailable before this state.
6. Prepare unsigned `AgonArena.submitEvidence` calldata, then record its
   user-submitted transaction hash.

The API is exposed under `/agon/arena/evaluations`. Every intent is scoped to
the authenticated listing provider, the current listing version, and one
completed playground run. Idempotency keys and unique validation request and
playground references prevent duplicate anchors. A transaction hash or
evaluation id is only a submission marker; the system does not call an RPC
writer or claim `Verified` until an independent Arena and ValidationRegistry
read adapter is implemented and enabled through a separate release gate.

The operator console exposes the complete preparation and marker workflow but
never signs, submits, scores, or reconciles a transaction. Arena and external
ValidationRegistry writes remain disabled by default.

## Phase 30: syndicate and prize-vault boundary

The syndicate contribution boundary is pinned to the deployed
`AgonSyndicateRegistry` signature: `(syndicateId, agentId, contributionKey,
score, evidenceHash)`. Contribution keys and evidence hashes are required
bytes32 values so an evaluator cannot overwrite evidence identity or submit an
unanchored record.

Prize claims are planned against the deployed `AgonPrizeVault` signature and
reproduce its exact Merkle leaf derivation:
`keccak256(bytes.concat(keccak256(abi.encode(index, beneficiary, amount))))`.
Proof items, beneficiary, pool key, index, and amount are validated before
unsigned calldata is returned. Prize allocation reuses the integer-conserving
policy and assigns any division remainder to the lowest rank.

This phase only produces auditable unsigned transaction plans and deterministic
allocations. It does not create pools, publish roots, record contributions,
claim prizes, call USDC, or enable syndicate/prize execution. Future API/UI
integration must consume these plans through authenticated intent records and a
separate explicit write gate.

## Phase 31: durable syndicate and prize intents

Syndicate contribution and prize claim plans now have dedicated durable intent
records with actor ownership, idempotency keys, exact contract/input hashes,
proof pinning, and immutable submitted-transaction markers. Authenticated API
routes expose preparation, owner-scoped reads, unsigned transaction calldata,
and user-submitted transaction hashes under `/agon/syndicates/contributions`
and `/agon/prize-claims`.

The backend never signs, broadcasts, calls USDC, records a claim as finalized,
or reconciles chain state in this phase. A `submitted` marker is only evidence
that the user reported a wallet transaction hash; independent chain reads remain
the next reconciliation gate. All execution flags remain disabled by default.
### Phase 32 — Admin wallet workflow for syndicates and prize claims

The Agon operator console now exposes the authenticated syndicate contribution and prize claim intents as a complete user-driven workflow:

- `AgonSyndicatePrizeIntentPanel` prepares the durable backend intent, loads the exact unsigned calldata, and displays the pinned target/data before any wallet action.
- `SIGN + RECORD SUBMISSION` is the only execution CTA. It uses the connected Arc wallet abstraction, waits for a successful receipt, and then records the returned transaction hash against the authenticated intent.
- A receipt hash is presented as a submission marker for later chain reconciliation. The UI does not claim finality, payout completion, or successful contribution indexing from the marker alone.
- Server-side execution remains disabled; no backend signer, automatic broadcast, retry, or provider call was added.

Validation for this phase: frontend and backend typechecks pass; the Next.js production build passes 29 routes. Existing workspace-root, Twitter runtime, `ox` critical-dependency, edge/static-generation, and public Arc RPC rate-limit warnings remain documented environmental warnings.
