# Agon Market Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Agon's chain-neutral market foundation so any externally owned ERC-8004 agent can bind a profile, publish a versioned service listing, and appear publicly with an explicit unverified warning.

**Architecture:** `AgonProfileRegistry` reads ownership directly from an external ERC-8004 identity registry. `AgonServiceRegistry` anchors immutable listing versions and lifecycle facts. Pure TypeScript modules validate manifests and capabilities; Postgres projectors build public read models; Next.js exposes the first Agon-branded discovery surfaces while legacy game features become read-only.

**Tech Stack:** Solidity 0.8.24, Foundry 1.7.1, OpenZeppelin 5, ERC-8004, TypeScript 5.9.3, Hono, viem, Postgres, Next.js 15.5.18, React 19.2.6.

---

## File map

```text
contracts/src/interfaces/IERC8004Identity.sol
contracts/src/AgonProfileRegistry.sol
contracts/src/AgonServiceRegistry.sol
contracts/test/AgonProfileRegistry.t.sol
contracts/test/AgonServiceRegistry.t.sol
contracts/script/DeployAgonFoundation.s.sol
contracts/deployments/agon-arc-testnet.json

backend/src/agon/core/{result,identity,manifest,listing,lifecycle}.ts
backend/src/agon/adapters/{erc8004,profile-registry,service-registry}.ts
backend/src/agon/http/{api-types,routes}.ts
backend/src/agon/store/{repository,projector}.ts
backend/test/agon/*.test.ts
backend/fixtures/agon-service-manifest.json
backend/src/db/schema.sql
backend/src/config/index.ts
backend/src/config/deployments.ts
backend/src/auth/index.ts
backend/src/indexer/index.ts

frontend/src/lib/agon/{types,client,canonical,verify}.ts
frontend/src/components/agon/{ListingCard,VerificationBadge,UnverifiedWarning,ServiceProof}.tsx
frontend/src/app/market/page.tsx
frontend/src/app/market/[id]/page.tsx
frontend/src/app/market/new/page.tsx
frontend/src/components/redesign/TopNav.tsx
```

### Task 1: Freeze the Agon namespace and legacy boundary

**Files:**
- Modify: `README.md`
- Modify: `PLAN-V2.md`
- Create: `docs/AGON.md`
- Create: `docs/legacy-arcrun.md`
- Modify: `frontend/src/components/redesign/TopNav.tsx`

- [ ] **Step 1: Write the naming and legacy acceptance test**

Create `scripts/check-agon-boundary.ps1` that fails when new Agon directories contain `ArcRun`, or active navigation contains tier/training/trait/mystery-box routes:

```powershell
$failed = $false
$agonPaths = @('backend/src/agon', 'frontend/src/lib/agon', 'frontend/src/components/agon', 'contracts/src/AgonProfileRegistry.sol', 'contracts/src/AgonServiceRegistry.sol')
foreach ($path in $agonPaths) {
  if (Test-Path $path) {
    $hits = Get-ChildItem $path -Recurse -File | Select-String -Pattern 'ArcRun'
    if ($hits) { $hits; $failed = $true }
  }
}
$legacyNav = Select-String -Path 'frontend/src/components/redesign/TopNav.tsx' -Pattern 'training|traits|mystery'
if ($legacyNav) { $legacyNav; $failed = $true }
if ($failed) { exit 1 }
```

- [ ] **Step 2: Run the boundary test and confirm it fails before migration**

Run: `powershell -ExecutionPolicy Bypass -File scripts/check-agon-boundary.ps1`
Expected: FAIL if active legacy navigation remains or new Agon files use the old brand.

- [ ] **Step 3: Document the active and archived product boundary**

`docs/AGON.md` must state: one external ERC-8004 identity, permissionless listings, direct x402 for unverified services, verification-gated escrow/Arena, and six planned contracts. `docs/legacy-arcrun.md` must list every legacy contract and route as read-only or removed from active navigation.

- [ ] **Step 4: Update navigation and public copy**

Replace active ArcRun marketplace labels with `Agon Market`; remove active links to training, traits, and mystery boxes. Do not delete legacy pages in this task.

- [ ] **Step 5: Verify and commit**

Run: `powershell -ExecutionPolicy Bypass -File scripts/check-agon-boundary.ps1 && git diff --check`
Expected: PASS.

```bash
git add README.md PLAN-V2.md docs/AGON.md docs/legacy-arcrun.md scripts/check-agon-boundary.ps1 frontend/src/components/redesign/TopNav.tsx
git commit -m "docs: establish Agon product boundary"
```

### Task 2: Define direct ERC-8004 ownership

**Files:**
- Create: `contracts/src/interfaces/IERC8004Identity.sol`
- Create: `contracts/src/AgonProfileRegistry.sol`
- Test: `contracts/test/AgonProfileRegistry.t.sol`

- [ ] **Step 1: Write failing ownership tests**

Test external NFT ownership, zero addresses, nonexistent identities, owner-only metadata updates, suspension, and ownership transfer:

```solidity
function test_bindProfile_requiresCurrentErc8004Owner() public {
    identity.mint(provider, 42);
    vm.prank(stranger);
    vm.expectRevert(AgonProfileRegistry.NotIdentityOwner.selector);
    profiles.bindProfile(42, "ipfs://profile");
}

function test_transferredIdentity_givesControlToNewOwner() public {
    identity.mint(provider, 42);
    vm.prank(provider);
    profiles.bindProfile(42, "ipfs://v1");
    identity.transferFrom(provider, buyer, 42);
    vm.prank(provider);
    vm.expectRevert(AgonProfileRegistry.NotIdentityOwner.selector);
    profiles.updateProfile(42, "ipfs://old-owner");
    vm.prank(buyer);
    profiles.updateProfile(42, "ipfs://new-owner");
}
```

- [ ] **Step 2: Run red test**

Run: `cd contracts && forge test --match-contract AgonProfileRegistryTest -vvv`
Expected: compilation fails because the interface and registry do not exist.

- [ ] **Step 3: Implement the minimal interface and registry**

`IERC8004Identity` exposes `ownerOf(uint256)`. `AgonProfileRegistry` stores `agentId`, metadata URI, status, owner snapshot, and timestamps. Every mutation calls `identityRegistry.ownerOf(agentId)` and compares it to `msg.sender`; snapshots are provenance, not authorization.

- [ ] **Step 4: Add lifecycle tests**

Cover `Active`, `Suspended`, and `Archived`; admin suspension with reason hash; owner archival; metadata URI length; duplicate bind; ownership sync event; and zero token ID policy.

- [ ] **Step 5: Verify and commit**

Run: `cd contracts && forge fmt --check && forge test --match-contract AgonProfileRegistryTest -vvv`
Expected: PASS.

```bash
git add contracts/src/interfaces/IERC8004Identity.sol contracts/src/AgonProfileRegistry.sol contracts/test/AgonProfileRegistry.t.sol
git commit -m "feat: add Agon ERC-8004 profiles"
```

### Task 3: Add versioned permissionless service listings

**Files:**
- Create: `contracts/src/AgonServiceRegistry.sol`
- Test: `contracts/test/AgonServiceRegistry.t.sol`

- [ ] **Step 1: Write failing listing tests**

```solidity
function test_publish_allowsCurrentIdentityOwner() public {
    _bind(provider, 42);
    vm.prank(provider);
    uint256 listingId = services.publish(
        42,
        keccak256("secure-review"),
        keccak256(bytes(canonicalManifest)),
        "ipfs://manifest-v1",
        1,
        AgonServiceRegistry.PaymentRail.X402
    );
    assertEq(listingId, 1);
    assertEq(uint8(services.getListing(1).verification), uint8(AgonServiceRegistry.Verification.Unverified));
}
```

Cover non-owner refusal, stable key uniqueness, immutable versions, status changes, category nonzero, URI/hash validation, `X402` and `Escrow` rails, and prevention of unverified escrow activation.

- [ ] **Step 2: Run red test**

Run: `cd contracts && forge test --match-contract AgonServiceRegistryTest -vvv`
Expected: compilation fails because `AgonServiceRegistry` does not exist.

- [ ] **Step 3: Implement listing state**

Define:

```solidity
enum ListingStatus { Listed, Suspended, Delisted }
enum Verification { Unverified, Pending, Verified, Expired, Suspended, Revoked }
enum PaymentRail { X402, Escrow }
```

Each version anchors `agentId`, service key hash, manifest hash, URI, category, payment rail, version, provider snapshot, and timestamps. Authorization calls `AgonProfileRegistry.currentOwner(agentId)` or the external identity registry through a narrow interface.

- [ ] **Step 4: Enforce unverified policy**

`X402` listings may be published unverified. `Escrow` declarations may be stored but `escrowEligible(listingId)` returns false until a later Arena credential sets `Verified`. Only an authorized future verifier role may change verification state.

- [ ] **Step 5: Verify and commit**

Run: `cd contracts && forge fmt --check && forge test --match-contract AgonServiceRegistryTest -vvv && forge test`
Expected: all suites PASS.

```bash
git add contracts/src/AgonServiceRegistry.sol contracts/test/AgonServiceRegistry.t.sol
git commit -m "feat: add Agon service listings"
```

### Task 4: Wire foundation deployment without touching legacy deployments

**Files:**
- Create: `contracts/script/DeployAgonFoundation.s.sol`
- Create: `contracts/deployments/agon-arc-testnet.example.json`
- Modify: `backend/src/config/deployments.ts`
- Test: `backend/test/agon/config.test.ts`

- [ ] **Step 1: Write failing deployment config tests**

Assert a path-specific issue for missing `AgonProfileRegistry` or `AgonServiceRegistry`, and accept chain-neutral ERC-8004 registry metadata:

```ts
assert.deepEqual(issue.path, ["contracts", "AgonProfileRegistry"]);
assert.equal(parsed.external.IdentityRegistry.chainId, 5042002);
```

- [ ] **Step 2: Implement the deployment script**

Deploy only the two new foundation contracts. Constructor inputs are admin multisig and external ERC-8004 IdentityRegistry. Do not redeploy any legacy contract.

- [ ] **Step 3: Add receipt-shaped example config**

The example contains empty address fields and is never imported by runtime. Runtime config must refuse registration mode until real receipt addresses are present.

- [ ] **Step 4: Verify and commit**

Run: `cd contracts && forge build; cd ../backend && npm run typecheck`
Expected: PASS.

```bash
git add contracts/script/DeployAgonFoundation.s.sol contracts/deployments/agon-arc-testnet.example.json backend/src/config/deployments.ts backend/test/agon/config.test.ts
git commit -m "feat: wire Agon foundation deployment"
```

### Task 5: Build the pure manifest and listing core

**Files:**
- Create: `backend/src/agon/core/result.ts`
- Create: `backend/src/agon/core/identity.ts`
- Create: `backend/src/agon/core/manifest.ts`
- Create: `backend/src/agon/core/listing.ts`
- Create: `backend/src/agon/core/lifecycle.ts`
- Create: `backend/fixtures/agon-service-manifest.json`
- Test: `backend/test/agon/manifest.test.ts`
- Test: `backend/test/agon/lifecycle.test.ts`

- [ ] **Step 1: Write golden canonicalization tests**

Reuse the marketplace canonical algorithm, but rename imports into the Agon namespace. Pin one UTF-8 keccak256 fixture hash. Reject floats/exponents for USDC, remote schema refs, executable schema keywords, duplicate tags, invalid HTTPS endpoints, and missing x402 pricing metadata.

- [ ] **Step 2: Write the listing lifecycle matrix**

Pin every command/state pair for `Listed`, `Suspended`, and `Delisted`, plus verification states. Return typed failures rather than throwing for business rules.

- [ ] **Step 3: Implement by extracting reusable marketplace code**

Move canonical and validation behavior from `backend/src/marketplace` into `backend/src/agon/core`. Leave compatibility re-exports until the frontend migration plan removes old imports.

- [ ] **Step 4: Verify and commit**

Run each file separately in the sandbox or the normal suite outside it:

```bash
cd backend
node --experimental-strip-types --test test/agon/manifest.test.ts
node --experimental-strip-types --test test/agon/lifecycle.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add backend/src/agon/core backend/fixtures/agon-service-manifest.json backend/test/agon backend/src/marketplace
git commit -m "feat: add Agon listing core"
```

### Task 6: Add Postgres read models and idempotent projection

**Files:**
- Modify: `backend/src/db/schema.sql`
- Create: `backend/src/agon/store/repository.ts`
- Create: `backend/src/agon/store/projector.ts`
- Test: `backend/test/agon/repository.test.ts`
- Test: `backend/test/agon/projector.test.ts`

- [ ] **Step 1: Write database integration tests**

Use `TEST_DATABASE_URL`. Test profile ownership snapshots, immutable listing versions, service-key uniqueness, append-only audits, transaction rollback, cursor independence, replay, overlap, and `(chain_id, tx_hash, log_index)` deduplication.

- [ ] **Step 2: Add idempotent tables**

Create `agon_profiles`, `agon_listings`, `agon_listing_versions`, `agon_listing_events`, `agon_chain_events`, and `agon_indexer_state`. Use lowercase addresses, numeric chain IDs, checksummed hashes, constrained status text, and explicit indexes.

- [ ] **Step 3: Implement transaction-scoped repository and projector**

All event insertion, projection, audit insertion, and cursor advancement occur in one database transaction. A hash/provider/version mismatch sets the listing to suspended and records a quarantine event.

- [ ] **Step 4: Verify migration replay and commit**

Run:

```bash
cd backend
npm run migrate
node --experimental-strip-types --test test/agon/repository.test.ts
node --experimental-strip-types --test test/agon/projector.test.ts
npm run migrate
npm run typecheck
```

Expected: both migration runs and tests PASS.

```bash
git add backend/src/db/schema.sql backend/src/agon/store backend/test/agon
git commit -m "feat: project Agon market state"
```

### Task 7: Add public APIs and explicit unverified warnings

**Files:**
- Create: `backend/src/agon/http/api-types.ts`
- Create: `backend/src/agon/http/routes.ts`
- Modify: `backend/src/auth/index.ts`
- Test: `backend/test/agon/routes.test.ts`

- [ ] **Step 1: Write route tests**

Cover public list/detail/category/agent routes, authenticated profile binding and listing publication, owner refusal, validation paths, stable pagination, unavailable contract capability, and response fields `verification.status`, `verification.scope`, `risk.unverified`, `payment.directX402`, and `payment.escrowEligible`.

- [ ] **Step 2: Implement thin Hono routes**

Handlers parse, authenticate, call an injected service, map typed failures, and return shared response types. Routes do not call viem or pg directly.

- [ ] **Step 3: Add capability health**

`/health` reports identity reads, profile writes, listing reads, listing writes, endpoint QA, direct x402 availability, and escrow availability. Escrow must remain false in this plan.

- [ ] **Step 4: Verify and commit**

Run: `cd backend && node --experimental-strip-types --test test/agon/routes.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add backend/src/agon/http backend/src/auth/index.ts backend/test/agon/routes.test.ts
git commit -m "feat: expose Agon market API"
```

### Task 8: Ship the first Agon Market UI

**Files:**
- Create: `frontend/src/lib/agon/types.ts`
- Create: `frontend/src/lib/agon/client.ts`
- Create: `frontend/src/lib/agon/canonical.ts`
- Create: `frontend/src/lib/agon/verify.ts`
- Create: `frontend/src/components/agon/ListingCard.tsx`
- Create: `frontend/src/components/agon/VerificationBadge.tsx`
- Create: `frontend/src/components/agon/UnverifiedWarning.tsx`
- Create: `frontend/src/components/agon/ServiceProof.tsx`
- Create: `frontend/src/app/market/page.tsx`
- Create: `frontend/src/app/market/[id]/page.tsx`
- Create: `frontend/src/app/market/new/page.tsx`
- Modify: `frontend/src/components/redesign/TopNav.tsx`
- Test: `frontend/src/lib/agon/agon.test.ts`

- [ ] **Step 1: Write UI-state tests**

Cover loading, empty, API failure, unverified warning, verified credential display, mismatch, stale ownership, pagination, and escrow-ineligible copy.

- [ ] **Step 2: Implement browser-safe verification**

Canonicalization imports no Node modules. The detail page shows manifest hash, recomputed hash, identity registry, agent ID, owner snapshot, listing version, verification state, and provenance.

- [ ] **Step 3: Build discovery and publishing pages**

The listing form binds an existing ERC-8004 identity; it never offers platform-agent minting, training, tiers, traits, or mystery boxes. Final copy says `Publish unverified listing`; it does not imply Arena verification.

- [ ] **Step 4: Verify and commit**

Run: `cd frontend && npm run test:marketplace && npm run typecheck && npm run build`
Expected: PASS, with `/market`, `/market/[id]`, and `/market/new` in the route table.

```bash
git add frontend/src/lib/agon frontend/src/components/agon frontend/src/app/market frontend/src/components/redesign/TopNav.tsx
git commit -m "feat: ship Agon Market foundation"
```

### Task 9: Add proof script and foundation release gate

**Files:**
- Create: `backend/scripts/prove-agon-foundation.ts`
- Modify: `backend/package.json`
- Modify: `README.md`
- Modify: `docs/AGON.md`

- [ ] **Step 1: Implement deterministic proof**

The proof binds a mock ERC-8004 identity, publishes a listing, projects a synthetic registration event, fetches the public listing, recomputes the hash, and prints named refusals for wrong owner, duplicate key, unsafe endpoint, hash mismatch, and escrow-ineligible unverified listing.

- [ ] **Step 2: Add scripts**

```json
{
  "test:agon": "node --experimental-strip-types --test test/agon/*.test.ts",
  "prove:agon": "node --experimental-strip-types scripts/prove-agon-foundation.ts"
}
```

- [ ] **Step 3: Run the complete foundation gate**

```bash
cd contracts
forge fmt --check
forge test
cd ../backend
npm run migrate
npm run test:agon
npm run typecheck
npm run prove:agon
cd ../frontend
npm run typecheck
npm run build
cd ..
powershell -ExecutionPolicy Bypass -File scripts/check-agon-boundary.ps1
git diff --check
```

Expected: every command exits zero. The proof must state that mock/testnet evidence does not prove mainnet availability, endpoint quality, legal compliance, escrow, Arena verification, or syndicate payouts.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/prove-agon-foundation.ts backend/package.json README.md docs/AGON.md
git commit -m "test: prove Agon market foundation"
```
