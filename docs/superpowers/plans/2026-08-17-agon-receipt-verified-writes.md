# Agon Receipt-Verified Writes Implementation Plan

> Execution follows `izie-build-standard`: test-first, fail closed, preserve existing work, and stop before any real transaction unless the user approves the exact call.

## Goal

Make the canonical Arc Testnet Agon deployment usable without turning the backend into a shared signing wallet. The authenticated ERC-8004 owner prepares an exact transaction, signs through ArcRun's existing injected-wallet or Circle per-user wallet path, and then asks the backend to verify the successful onchain receipt and canonical event. A prepared operation is not a published listing and never implies Agon verification.

## Architecture decision

`AgonProfileRegistry.bindProfile` and `AgonServiceRegistry.publish` authorize `msg.sender` against the current ERC-8004 owner. Therefore the backend must not sign these calls with a global private key.

Use a two-phase write protocol:

1. `POST /agon/profiles/bind` or `POST /agon/listings` validates ownership, simulates the exact call, and durably returns a `prepared` operation plus transaction intent.
2. The user signs that intent through `useArcWrite`, which already selects injected wagmi or the authenticated user's Circle Developer-Controlled wallet.
3. `POST /agon/operations/:operationId/confirm` accepts only a transaction hash, loads the prepared operation for the authenticated actor, checks a successful receipt on the configured Arc chain, and matches the canonical contract event and every material argument.
4. Confirmation is idempotent. The same operation/hash returns the existing proof; a different hash or reused hash conflicts.

## Safety gates

Write preparation and health capabilities remain disabled unless all gates pass:

- `AGON_WRITES_ENABLED=true` is explicit.
- the canonical Agon deployment receipt parses in registration mode;
- deployment chain ID equals backend chain ID and the RPC-reported chain ID;
- bytecode exists at both Agon contract addresses;
- `AgonProfileRegistry.identityRegistry()` equals the receipt's official IdentityRegistry;
- `AgonServiceRegistry.profiles()` equals the receipt's profile registry;
- authenticated actor equals `currentOwner(agentId)`;
- viem simulation succeeds for the exact call.

No private key enters this adapter. No capability is inferred merely because an adapter object exists.

## Task 1: Contract ABI and deployment readiness

Files:

- Add `backend/src/agon/write/abi.ts`
- Add `backend/src/agon/write/readiness.ts`
- Add `backend/test/agon/write-readiness.test.ts`
- Update `backend/src/config/deployments.ts`
- Update `backend/src/config/index.ts`
- Update `backend/test/agon/config.test.ts`

Tests cover every gate and report stable failure reasons without exposing secrets. Readiness uses an injected viem-compatible reader so tests require no network.

## Task 2: Durable, idempotent operation store

Files:

- Update `backend/src/db/schema.sql`
- Add `backend/src/agon/write/repository.ts`
- Add `backend/test/agon/write-repository.test.ts`

Store the authenticated actor, operation kind, canonical payload hash, exact transaction intent, state, and confirmed receipt proof. Enforce uniqueness for `(actor, kind, payload_hash)` and for a confirmed transaction hash. Repeating the same preparation returns the same operation.

## Task 3: Viem prepare/confirm adapter

Files:

- Add `backend/src/agon/write/adapter.ts`
- Add `backend/test/agon/write-adapter.test.ts`

Prepare uses `readContract`, `simulateContract`, and `encodeFunctionData`. Confirm uses `getTransactionReceipt` and decoded canonical events. A receipt must be successful and contain exactly one matching `ProfileBound` or `ListingPublished` log from the configured contract. For account-abstraction compatibility, ownership is proven by the event's owner/provider argument rather than assuming the outer transaction sender is the smart account.

## Task 4: HTTP capability and confirmation contract

Files:

- Update `backend/src/agon/http/api-types.ts`
- Update `backend/src/agon/http/service.ts`
- Update `backend/src/agon/http/routes.ts`
- Update `backend/test/agon/service.test.ts`
- Update `backend/test/agon/routes.test.ts`
- Update `backend/src/auth/index.ts`

Return `prepared` only after durable persistence. Add authenticated confirmation. Expose readiness reasons in health while keeping existing boolean capability fields. Add the Agon addresses to Circle's allowlist only when configured, and permit only the two foundation function signatures on those addresses.

## Task 5: Marketplace and ASP CLI integration

Files:

- Add `frontend/src/lib/agon/abi.ts`
- Update `frontend/src/lib/agon/types.ts`
- Update `frontend/src/lib/agon/client.ts`
- Update `frontend/src/app/market/new/page.tsx`
- Update `frontend/src/lib/agon/asp.ts`
- Update `frontend/scripts/asp.ts`
- Update `frontend/src/lib/agon/asp.test.ts`
- Update `.agents/skills/agon-asp/SKILL.md`
- Update `.agents/skills/agon-asp/references/cli.md`

The marketplace prepares, displays the wallet-signing state, executes the exact ABI call through `useArcWrite`, waits for `confirmTx`, and sends the hash for backend proof. The ASP CLI publication command prepares but does not possess a private key; it outputs the transaction intent and operation ID. A separate `confirm` command verifies a supplied transaction hash after execution by an approved wallet tool. CLI wording must distinguish `prepared`, `confirmed/provider listed`, and `verified`.

## Task 6: Verification and transaction boundary

Run focused tests, backend/frontend typechecks, marketplace/ASP tests, production frontend build, Agon proof/boundary scripts, full Foundry tests, and `git diff --check`. Then present the exact profile/listing transaction details and wait for explicit approval before any Arc Testnet broadcast.

