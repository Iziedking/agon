# Legacy ArcRun wallet recovery runbook

> This is a legacy ArcRun operations document. It covers the original wallet
> layout and recovery process, including names that are no longer Agon
> product identities. Keep it for historical incident context; current Agon
> release status lives in [../AGON.md](../AGON.md).

The on-call doc for when a production key is lost, leaked, rotated, or
needs an emergency revoke. Seven secrets hold ArcRun's production
responsibilities; this file says what each can do, where it lives, what
breaks if it's compromised, and how to swap it without taking the
platform down.

Pair this with the automated `checkWalletSeparation()` boot check in
`backend/src/coordinator/walletCheck.ts`, which flags collisions but does
not tell you what to do when one happens. Note its scope: it only resolves
coordinator, validator, treasury, and scout-master[0]. The x402 payment
wallet and the Circle custody credentials (sections 6 and 7) are outside
it, so nothing warns you at boot if they are wrong.

---

## Quick reference

| Secret | On-chain role | Held by | Lose it → |
|---|---|---|---|
| **admin** | `DEFAULT_ADMIN_ROLE` on all six contracts | Hardware wallet (cold) | Total freeze. Redeploy required. |
| **treasury** | Recipient of listing fees and platform-fee skims; payer of mission refunds | Hot key in the backend env (`TREASURY_PRIVATE_KEY`) | Mission refunds break. Fees route to a dead address until admin re-targets. Old funds stuck. |
| **coordinator** | `COORDINATOR_ROLE` on ContestEngine, ChallengeArena, SyndicateFactory, PointsLedger | KMS / HSM (warm) | Contests stop opening and settling. Admin grants role to new key. |
| **validator** | Implicit (caller of `ReputationRegistry.giveFeedback`) | KMS / HSM (warm) | ERC-8004 feedback stops. In-game scoring keeps working. Swap key. |
| **scout-master** | Mnemonic deriving every Scout, mission-operative, and specialist hot wallet | KMS / sealed envelope | Hot wallet funds at risk if leaked. Sweep, regenerate, swap env. |
| **nanopay-wallet** | None. Signs every x402 research payment: Exa and Gloria on Base **mainnet**, ArcRun's own market-intel seller on Arc | Hot key in the backend env (`NANOPAY_WALLET_PRIVATE_KEY`) | Real mainnet USDC and the Gateway balance are gone. Research calls stop. |
| **circle-custody** | None. API credentials with custody of every email operator's wallet | Secret manager, read into the backend env | Every email user's funds are drainable by the holder. The worst leak in the system. |

Cold = air-gapped, used only for governance operations (a few times a
year). Warm = signing service callable from the backend (signs many txs
per day). Hot = a raw key or credential sitting in the backend's
environment, usable by anything that can read that environment.

Only admin is cold today. Everything else is warm or hot, and the last
three rows are secrets a backend process reads at startup. Treat "leaked
the backend env" as leaking treasury, scout-master, nanopay-wallet, and
the Circle custody credentials all at once, and plan the incident
response around that, not around one key at a time.

---

## 1. admin

### Role and powers

The single most powerful key on the platform. Holds `DEFAULT_ADMIN_ROLE`
on every contract:

- `PrizeEscrow`: grant `CONTROLLER_ROLE`, set treasury via
  `setTreasury()`, sweep unclaimed.
- `AgentRegistry`: grant `CONTEST_ENGINE_ROLE`, set treasury, set
  upgrade prices.
- `ContestEngine`: grant `COORDINATOR_ROLE`, set listing fee, set
  default platform fee bps (capped at 20%), cancel any contest.
- `ChallengeArena`: grant `COORDINATOR_ROLE`, cancel challenges.
- `SyndicateFactory`: grant `COORDINATOR_ROLE`.
- `PointsLedger`: grant `COORDINATOR_ROLE` and `CONTEST_ENGINE_ROLE`.

The admin key cannot directly steal user funds (claims are pull-based,
gated by merkle proofs) but it can drain the treasury via
`PrizeEscrow.sweepUnclaimed()` after the 30-day window, and it can
re-route future fees by changing the treasury address.

### Storage

Cold storage only: hardware wallet (Ledger / Trezor) plus a sealed
seed-phrase backup in a separate location. The admin key signs
governance operations a handful of times per year; it should never sit
on a server.

### Blast radius if compromised

Worst case in the entire platform. Attacker can:

- Revoke `CONTROLLER_ROLE` from ContestEngine and ChallengeArena,
  freezing all settle / claim paths.
- Grant `COORDINATOR_ROLE` to their own key and post fake merkle roots.
- Change treasury to their own address; future fees flow to them.
- After 30 days, sweep unclaimed pool funds via
  `PrizeEscrow.sweepUnclaimed()`.

Time to drain: seconds for role hijack, hours for treasury drift to be
noticed, 30 days for unclaimed sweeps.

### Detection

Monitor for any of these events on-chain via the indexer:

- `RoleGranted` or `RoleRevoked` on any of the six contracts where the
  signer is `admin` but the operation was not scheduled.
- `TreasuryUpdated` on `PrizeEscrow` or `AgentRegistry`.
- `ListingFeeUpdated` or `PlatformFeeUpdated` on `ContestEngine`.

Suggested: a separate "ops" wallet runs a daily `eth_getLogs` filter for
the above events with their indexed signer = admin address, posts to a
private Slack/Discord channel.

### Rotation procedure

```text
1. Generate the new admin key on a fresh hardware wallet.
2. From the OLD admin, for each of the six contracts:
     grantRole(DEFAULT_ADMIN_ROLE, NEW_ADMIN)
3. Verify the NEW admin can call a governance op (e.g. setTreasury to
   the same address, a no-op that proves the role works).
4. From the OLD admin, for each contract:
     renounceRole(DEFAULT_ADMIN_ROLE, OLD_ADMIN)
5. Wipe the old hardware wallet.
6. Update contracts/deployments/arc-testnet.json `roles.admin` to the
   new address.
```

Never `revokeRole` the old admin from the new admin in the same tx
sequence. `renounceRole` from the old key is the standard OpenZeppelin
AccessControl flow.

### Recovery / loss procedure

There is no recovery. The admin key is the root of all governance; if
both the hardware wallet AND the seed backup are gone:

- Existing contests and claims keep working (settlement uses
  `COORDINATOR_ROLE`, not admin). Funds are not stuck.
- New fee config is locked at whatever it was last set to.
- `COORDINATOR_ROLE` cannot be rotated. If the coordinator key is later
  lost too, the platform is fully stuck.
- Treasury cannot be re-targeted. If the treasury key is later lost,
  future fees are stranded.

The only path back to a healthy platform is a full v2 contract redeploy
and migration. Plan accordingly: the admin seed backup is the
single most important physical artifact ArcRun owns.

---

## 2. treasury

### Role and powers

The address that receives:

- Up-front listing fees on `ContestEngine.listContest()` (B2B revenue).
- Platform-fee skims on `ContestEngine.settle()` and
  `ChallengeArena.postWinnerRoot()` (% of pool).
- Agent upgrade USDC on `AgentRegistry.upgradeAgent()`.
- Unclaimed pool sweeps after 30 days via
  `PrizeEscrow.sweepUnclaimed()`.
- Mission operative join fees and specialist intel purchases
  (`mission_operative_fees`, `mission_intel_buys`).

No on-chain role: treasury is just an address stamped into each
contract's storage. It can spend USDC freely (standard EOA powers).

**It also SPENDS, and that is what makes it hot.** The treasury key is
`TREASURY_PRIVATE_KEY` in the backend env (`backend/src/config/index.ts`
line 161). Two live paths sign with it:

- `backend/src/runners/missions/fees.ts`. When a mission cancels with no
  qualifier, `refundMissionFees()` and `refundMissionBuys()` send every
  operative's join fee and every specialist's intel purchase back, one
  USDC `transfer` per row, signed by the treasury key. Without the key
  set, the fee path is disabled entirely: joins are free and nothing is
  charged (`config.treasury.privateKey` is the guard at the top of both
  functions).
- `POST /admin/treasury/withdraw` in `backend/src/auth/index.ts`.
  PrizeEscrow forwards fees straight to the treasury EOA, so the withdraw
  MUST sign with the treasury key. It falls back to the coordinator only
  when the coordinator IS the on-chain treasury, and refuses otherwise
  rather than silently moving coordinator funds.

### Storage

Hot key in the backend environment. This is NOT cold storage and the doc
should not pretend otherwise: a hardware wallet cannot sign an automatic
refund at settlement time, and a multi-sig cannot either.

Treat it like the coordinator key, not like admin:

- Secret manager (AWS Secrets Manager, GCP Secret Manager, Vault) injected
  at boot. Never in a committed file, never in a shell history.
- For mainnet, move it behind the same KMS signing service the coordinator
  needs. `refundMissionFees` builds a `privateKeyToAccount` viem wallet
  client; that is the seam to replace.
- Keep the working balance small. It only has to cover in-flight refunds
  and near-term skims. Sweep the rest to a genuinely cold address on a
  schedule via `POST /admin/treasury/withdraw`. The cold address is the
  one that can be a hardware wallet or a Safe; the signing treasury cannot.
- It must not collide with the coordinator. `checkWalletSeparation()` warns
  on this, and the contracts ship a deploy guard requiring
  `coordinator != treasury`.

### Blast radius if compromised

Attacker can transfer the whole treasury USDC balance to their own
address, and the balance is whatever revenue has accrued since the last
sweep, not a token float. Because the key lives in the backend env, the
realistic compromise path is not "someone stole a Ledger", it is "someone
read the environment of a running container", which hands them the
scout-master mnemonic and the x402 wallet in the same breath.

What they still cannot do: re-route future fees (admin does that), freeze
the platform, or touch escrowed pool funds (pull-based, merkle-gated).

The second-order damage is the refund path. A drained treasury cannot pay
out `refundMissionFees` / `refundMissionBuys`, so operatives who paid a
join fee and specialists who bought intel on a cancelled mission are owed
money the platform cannot send. Those are user funds in everything but
custody, and that is a support and trust incident, not just a revenue
loss. Refill the treasury address before restarting missions.

### Detection

Watch USDC `Transfer(treasury, *, value)` events. Any outbound transfer
that is not a mission refund (match it against `mission_operative_fees` /
`mission_intel_buys` rows stamped `refunded = true` with that
`refund_tx`) or an ops-approved withdraw is a compromise. A
balance-tracking dashboard with a daily snapshot makes drift obvious.

### Rotation procedure

```text
1. Generate the new treasury wallet.
2. From the ADMIN, for each contract that stores treasury:
     PrizeEscrow.setTreasury(NEW_TREASURY)
     AgentRegistry.setTreasury(NEW_TREASURY)
   (ContestEngine and ChallengeArena read treasury from PrizeEscrow at
    skim time, so the PrizeEscrow setter covers them.)
3. From the OLD treasury, transfer the remaining USDC balance to NEW.
4. Swap TREASURY_PRIVATE_KEY env to the new key and restart the backend.
   Skip this and the refund path keeps signing from a key the contracts
   no longer pay, so it drains the old address and then starts failing.
5. Verify: POST /admin/treasury/withdraw refuses when the key and the
   on-chain treasury disagree, so a tiny test withdraw proves they match.
6. Update contracts/deployments/arc-testnet.json `roles.treasury`.
```

Fees route to the new address from the block `setTreasury` lands. The only
downtime is the backend restart in step 4; a mission that cancels inside
that gap has its refunds retried by `refundAllCancelledMissions` (also
exposed in the admin console), so nothing is permanently missed.

### Recovery / loss procedure

If treasury is lost but admin is intact:

1. From admin, `setTreasury(NEW_TREASURY)` on `PrizeEscrow` and
   `AgentRegistry`. Future fees route to the new address.
2. Swap `TREASURY_PRIVATE_KEY` to the new key and restart, or the refund
   path stays dead.
3. Accept that USDC currently sitting at the dead treasury address is
   stranded forever, INCLUDING any join fees and intel purchases owed back
   to operators on cancelled missions. Fund the new treasury and re-run
   `refundAllCancelledMissions` so those operators are made whole from the
   new address; the refund rows are idempotent and keyed by
   `refunded = false`.
4. Audit how the key was lost; tighten storage before mainnet relaunch.

---

## 3. coordinator

### Role and powers

The orchestration key. Holds `COORDINATOR_ROLE` on:

- `ContestEngine`: `postScoreRoot()`, `settle()`, `cancelContest()`.
- `ChallengeArena`: `postWinnerRoot()`, `cancelChallenge()`.
- `SyndicateFactory`: `settleWeeklyWar()`.
- `PointsLedger`: `credit()`.

Off-chain it also:

- Funds Scout hot wallets via `fundHotWallets()` (using the
  coordinator's USDC balance, not protocol funds).
- Fronts each mission operative's working float, and funds specialist
  gas, from the same balance.
- Sweeps hot wallets after settlement via `sweepHotWallets()`.
- Pays listing fees and pool funding when opening platform-funded
  contests in autopilot mode.

The coordinator wallet holds two pools of USDC:

- A platform float for pool funding, Scout topups, and mission floats
  (operationally large, often 100s of USDC at a time).
- The gas float (USDC is native gas on Arc, so balance = gas).

### Storage

Warm wallet: KMS-backed signing service (AWS KMS, GCP Cloud KMS, or a
self-hosted HSM). The key signs many txs per day; cold storage is not
viable. Never raw `COORDINATOR_PRIVATE_KEY` in env on production. Dev
and staging can use env; mainnet must be KMS.

The current `TxSender` in `backend/src/coordinator/txSender.ts` builds a
`privateKeyToAccount`-backed viem `WalletClient`. For mainnet, swap that
in for a viem custom signer that asks KMS for each signature.

### Blast radius if compromised

Worst case: attacker can post fake `postScoreRoot()` calls that make
themselves the winner of every active contest, then call `settle()`,
then claim everything. Per-contest cap is the pool size.

They can also drain the coordinator's own USDC float (up to whatever
balance is loaded: this is not protocol funds, but it is ArcRun's
working capital).

Time to drain: one tx per contest. With ~5 live contests, ~5 txs.

### Detection

Watch the indexer for:

- `ContestScored` or `ContestSettled` events that were not preceded by
  a runner result in the coordinator's logs.
- `Transfer(coordinator, *, value)` USDC events where the recipient is
  not a known hot-wallet derivation, a contract, or treasury.

Alarm on these in real time, not daily. A fake-settle attack can be
done in minutes.

### Rotation procedure

```text
1. Generate the new coordinator key in KMS.
2. From ADMIN, for each contract:
     grantRole(COORDINATOR_ROLE, NEW_COORDINATOR)
3. Drain the OLD coordinator's USDC to a temporary safe address (you
   want it empty before you stop using it).
4. Stop the coordinator service.
5. Swap COORDINATOR_PRIVATE_KEY env (or KMS reference) to the new key.
6. Restart the coordinator. checkWalletSeparation() logs the new
   address; verify it matches.
7. From ADMIN:
     revokeRole(COORDINATOR_ROLE, OLD_COORDINATOR)
8. Move the temporary USDC to the new coordinator address.
9. Update contracts/deployments/arc-testnet.json `roles.coordinator`.
```

Downtime: the seconds between step 4 and step 6. Any contest whose
window closes in that gap stays OPEN until the next sweep tick after
restart and settles normally.

### Recovery / loss procedure

Coordinator key gone but admin intact:

1. Generate a new coordinator key.
2. Admin runs the rotation steps above.
3. Any contests left OPEN by the old coordinator that hold escrowed pool
   funds can be settled by the new coordinator (it picks them up via
   the due-sweeper on restart) OR cancelled by admin via
   `cancelContest()`, refunding the sponsor.

If both admin AND coordinator are gone: contracts cannot be settled,
pools are stranded until the 30-day unclaimed window opens
(admin-gated, so also stuck without admin). Full redeploy required.

---

## 4. validator

### Role and powers

Calls `ReputationRegistry.giveFeedback()` on the external ERC-8004
contract after every contest and challenge settles. The validator EOA
holds no on-chain role: its authority comes from the no-self-feedback
rule: the registry rejects feedback where the caller owns the agent
NFT. AgentRegistry owns all ArcRun agent NFTs, so any non-AgentRegistry
EOA can validate them, but the validator must not collide with the
coordinator (because the coordinator's key is what AgentRegistry uses
internally; the rejection rule is more subtle than just "must not be
the NFT owner address", so keep them distinct).

### Storage

Warm wallet, same KMS pattern as coordinator. The validator signs a few
txs per contest settlement; load is modest.

### Blast radius if compromised

Attacker can post arbitrary `giveFeedback()` calls: fake wins for
their own agents, fake losses for competitors. The ERC-8004 standing
this fakes is portable across other Arc apps, so the reputation damage
extends beyond ArcRun.

They cannot touch USDC, cannot affect in-game scoring or payouts, and
cannot freeze the platform. The damage is purely to the portable
reputation signal.

### Detection

Watch `ReputationRegistry.giveFeedback` events tagged with the
ArcRun prefix (`arcrun-{type}-{result}-c{id}` for contests,
`-ch{id}` for challenges). Each tag must correspond to a real
`ContestSettled` or `ChallengeSettled` event in the same block window.
Any unmatched feedback is a compromise signal.

### Rotation procedure

```text
1. Generate the new validator key in KMS.
2. Stop the coordinator service.
3. Swap VALIDATOR_PRIVATE_KEY env (or KMS reference).
4. Restart. checkWalletSeparation() logs the new address; verify
   the boot banner says "ERC-8004 feedback enabled (validator: ...)".
5. No on-chain role change needed.
```

Downtime: same coordinator-restart window.

### Recovery / loss procedure

Trivial. Generate a new key, swap the env, restart. Past feedback under
the old key remains on-chain (cannot be un-said), but new feedback
flows from the new key. The on-chain record of "this validator went
quiet on date X, this new one started on date Y" is preserved.

---

## 5. scout-master

### Role and powers

A 12-or-24-word BIP-39 mnemonic. The backend derives one hot wallet per
agent via `mnemonicToAccount(SCOUT_MASTER_MNEMONIC, { addressIndex:
agentId })` (`deriveHotWallet`, `backend/src/runners/scout.ts`). The name
is now historical: it is no longer only Scout's. Three families of wallet
hang off this one mnemonic.

- **Scout agent wallets.** Funded by the coordinator before a Scout
  contest (`fundHotWallets`), execute real on-chain USDC work during it
  (swaps via `chain/appKitSwap.ts`, Arc to Base bridges via
  `chain/scoutBridge.ts`, self-transfers as the fallback), swept back
  after settlement (`sweepHotWallets`).
- **Mission operative wallets.** Same derivation by agentId
  (`runners/missions/runner.ts`). These are fronted a working float so the
  operative can BUY intel from specialists, and swept after settlement.
- **Mission specialist wallets.** Same derivation, on a reserved agentId
  range starting at `MISSION_SPECIALIST_AGENT_ID_BASE` (default 900000) so
  they never collide with a real operator agent
  (`runners/missions/specialists.ts`). They receive every agent-to-agent
  intel payment.

Hundreds or thousands of derived wallets may exist over time; only the
mnemonic is stored. Each `addressIndex` is deterministic from the
mnemonic, and the specialist range is just a high offset, not a separate
secret. One mnemonic, every hot wallet in the product.

### Storage

Sealed envelope split into multi-party shares (Shamir secret sharing,
or a manual k-of-n split written on paper). The mnemonic is read
ONCE at backend start, kept in memory only, never written to disk
outside the env file (which itself is gitignored).

For mainnet, replace with a KMS-derived signing service that hands out
per-agent signers without exposing the mnemonic. This is a
non-trivial refactor; on testnet, a sealed envelope is acceptable.

### Blast radius if compromised

Every hot wallet in the product (past, present, and future) is at risk, not
just Scout's. An attacker with the mnemonic can derive any `addressIndex`,
including the specialist range, and drain whatever USDC is sitting there.

Size it honestly. A Scout wallet is small, roughly 1-5 USDC. A mission
wallet is not: `MISSION_FUND_MAX_USDC` caps the per-operative float at 60
USDC by default, and the float is sized per mission to cover the intel
prices the operative expects to be quoted. Specialist wallets accumulate
on top of that, because every A2A intel sale in a running mission lands in
one. So the exposure at any instant is roughly:

    (active Scout wallets x ~5) + (operatives in flight x up to 60)
      + (specialist sale proceeds not yet swept)

which peaks while a mission is live and drops after the post-settlement
sweep. Time the estimate to a live mission, not to an idle platform.

Crucially, attackers still cannot touch agent ownership (that is
`AgentRegistry` storage, not the hot wallet) and cannot affect the on-chain
payout flow: prize claims are pull-based and merkle-gated, so a winner's
prize is not sitting in a derived wallet waiting to be taken. What they
steal is float and in-flight intel revenue.

### Detection

Daily aggregate-balance snapshot of two ranges: the first ~1000 derived
addresses (agents) AND the specialist range at
`MISSION_SPECIALIST_AGENT_ID_BASE` upward. Snapshotting only the low range
misses every specialist wallet. A drop without a corresponding settlement
run is compromise.

### Rotation procedure

```text
1. Stop the coordinator (prevents new Scout / mission funding while
   rotating).
2. Sweep every derived hot wallet back to the coordinator using the
   OLD mnemonic via a one-off script (extend sweepHotWallets to walk
   addressIndex 0..N). Walk the specialist range too
   (MISSION_SPECIALIST_AGENT_ID_BASE upward), or you strand every
   specialist's intel revenue.
3. Generate a new mnemonic. Seal and split it before continuing.
4. Swap SCOUT_MASTER_MNEMONIC env.
5. Restart the coordinator. checkWalletSeparation() logs the new
   scout-master[0] address.
6. Next Scout contest or mission funds new hot wallets at the new
   mnemonic's derivations. Old wallets are now orphan (zero balance, no
   scheduled funding).
```

Do not rotate with a mission open. The operatives' floats and the
specialists' proceeds are live in derived wallets mid-run; rotating under
them strands the money and fails the settlement sweep. Let the window
close and the sweep finish first.

### Recovery / loss procedure

Mnemonic gone but coordinator intact:

1. All currently-funded hot wallets are now permanently inaccessible to
   ArcRun. Their USDC is stranded (literally lost: no one holds the
   key). Audit how much is locked up, and check whether a mission was in
   flight: an operative float is up to 60 USDC, which is not the small
   number the Scout-only version of this doc assumed.
2. Generate a new mnemonic and swap env per the rotation steps.
3. Continue operating. Future contests and missions use the new mnemonic;
   old wallets are dead.

The platform survives mnemonic loss: agent ownership, pools, and payouts
are all on-chain and untouched. What is stranded is working capital, and
how much depends on what was running when the key went.

---

## 6. nanopay-wallet

### Role and powers

`NANOPAY_WALLET_PRIVATE_KEY` (`backend/src/config/index.ts` line 277). The
wallet that pays for EVERY x402 research call an agent makes. It is the
only key in the system that spends on a chain other than Arc, and the only
one that spends MAINNET money.

It signs both x402 paths (`backend/src/nanopayments/index.ts`, routed per
seller by `NANOPAY_PROVIDER=auto`):

- **exact scheme**, for standard x402 sellers. Exa (`api.exa.ai`) and
  Gloria (`api.itsgloria.ai`) settle on Base. `NANOPAY_EXACT_NETWORK`
  defaults to `base`, which is Base MAINNET. The wallet needs real USDC
  there.
- **Gateway batched nanopayments**, for sellers advertising
  `extra.name = GatewayWalletBatched`. ArcRun's own market-intel seller
  (`backend/src/nanopayments/arcSeller.ts`) is the one that does, and it
  settles on Arc Testnet. This path spends the wallet's **Circle Gateway
  balance**, funded by a deposit on `NANOPAY_GATEWAY_CHAIN` (`arcTestnet`).

So the wallet carries two distinct pots: an on-chain USDC balance on the
exact-scheme chain, which is real mainnet money, and a Circle Gateway
balance on Arc. Per-call spend is bounded by `NANOPAY_MAX_PER_CALL_USDC`
(default 2.0) and per-session by `NANOPAY_SESSION_BUDGET_USDC`, but those
are budget guards inside our own code, not a limit on what a thief can
move.

### Storage

Hot key in the backend env, same posture as treasury: secret manager,
injected at boot, never committed. It has to be hot, because agents pay
for data mid-run with no human in the loop.

The mitigation that actually works here is balance discipline, not storage
theatre. Keep it funded for days of research, not months. The Gateway
balance is the harder half: it is not on an explorer you can eyeball, so
check it deliberately rather than assuming a quiet balance means a safe
one.

Keep it distinct from every other key. It is not covered by
`checkWalletSeparation()`, so nothing will tell you if you reused the
coordinator key here.

### Blast radius if compromised

Direct, immediate, real-money loss, on MAINNET. An attacker drains:

- the wallet's mainnet USDC on Base (and any other exact-scheme chain it
  is funded on), and
- the Circle Gateway balance, spendable through the same batched path our
  own agents use.

This is the only ArcRun key whose compromise costs mainnet funds today.
Every other loss in this doc is testnet USDC or a role. Rank it
accordingly in an incident: Arc-side keys can be rotated at leisure, this
one is a live financial hole.

Operationally, research then stops: agents fall back to the unpaid
heuristics, missions still run and settle (the credit-requires-payment
grader simply credits nothing for a MAKE that never settled), and no user
funds are touched. The damage is ours, in real money.

### Detection

- Balance alarm on the wallet's mainnet USDC, with a floor. Any drop not
  matched by a `nanopayments` row is a compromise.
- Reconcile the Gateway balance against `nanopayments` spend on a schedule.
  A batched path that spends without a corresponding recorded call is the
  signal.
- Alarm on spend RATE, not just balance. The honest usage is many sub-cent
  to few-cent calls; a single large outbound is not something our code can
  produce, because `NANOPAY_MAX_PER_CALL_USDC` caps it.

### Rotation procedure

```text
1. Generate a new payment wallet.
2. Move the OLD wallet's mainnet USDC to the new one (or to cold storage).
3. Withdraw / re-deposit the Circle Gateway balance to the new wallet.
   Check Circle's withdrawal timing before you rely on it being instant.
4. Swap NANOPAY_WALLET_PRIVATE_KEY env. Set NANOPAY_WALLET_ADDRESS to
   match if the CLI path is in use.
5. Restart the backend. The boot log prints the exact-scheme signer
   address ("x402 exact-scheme (v1+v2) ready, signer 0x..."); verify it.
6. Make one paid call and confirm a nanopayments row with a settlement tx.
```

### Recovery / loss procedure

Key lost (not leaked): whatever is in the wallet and in Gateway is gone.
There is no recovery path and no one to appeal to. Generate a new wallet,
fund it, swap the env. Research resumes on the next call.

Key leaked: treat it as an active drain. Move the funds before you do
anything else, because you are racing the attacker for a balance that is
already spendable. Then rotate.

---

## 7. circle-custody (CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET / CIRCLE_WALLET_SET_ID)

### Role and powers

Not a wallet. These are the custody credentials for Circle
Developer-Controlled Wallets, and they are how ArcRun holds funds for
every operator who signed up with an email
(`backend/src/chain/circleDev.ts`).

The model, stated plainly: an email operator has no key. ArcRun mints them
a Circle wallet, and every on-chain write they make (ENTER, JOIN, CLAIM,
mint, train, withdraw) is executed by Circle on their behalf, authorized by
these credentials. `initiateDeveloperControlledWalletsClient({ apiKey,
entitySecret })` is the whole gate. Whoever holds the pair can call
`createContractExecutionTransaction` against any wallet in the wallet set,
which includes moving their USDC out.

- `CIRCLE_API_KEY`: authenticates the account to Circle.
- `CIRCLE_ENTITY_SECRET`: the signing secret over the wallet set.
  Registered once via `backend/scripts/circle-bootstrap.ts`.
- `CIRCLE_WALLET_SET_ID`: names the set the wallets live in. Not a secret
  by itself, but it tells an attacker exactly what to point the other two
  at.

The module header in `circleDev.ts` already flags this as the custody
seam: it is the one file a migration to user-controlled (passkey-signed)
wallets has to replace.

### Storage

Secret manager, injected at boot, and nowhere else. Not in the repo, not
in a shared password note, not pasted into a chat. The entity secret in
particular should be treated as the single most sensitive string ArcRun
handles after the admin seed.

Scope the API key as narrowly as Circle allows, and keep testnet and
mainnet credentials in separate secret paths so a testnet debug session
cannot reach mainnet custody.

### Blast radius if compromised

The worst outcome in the system, because it is the only compromise that
costs USERS money rather than ArcRun's.

Someone holding the API key and the entity secret can execute transactions
from every email operator's wallet in the set: transfer their USDC out,
call contracts as them, drain the lot. There is no per-user consent step
to defeat, because the whole design is that the platform acts on the user's
behalf. Nothing on-chain distinguishes an attacker's
`createContractExecutionTransaction` from ours.

Nothing in the wallet-separation boot check covers this, and no on-chain
alarm in this doc catches it either: the drain looks exactly like normal
platform activity from the outside.

The scale is every email user we have. This is also the reason the
custodial posture itself is a mainnet blocker, not just a key-handling
one: as long as the platform can move user funds, this credential IS the
users' funds, and the honest fix is to stop being able to move them
(migrate email signin to user-signed wallets, which is scoped in the
production notes).

### Detection

- Circle console: watch the transaction feed for the wallet set. Every
  legitimate transaction ArcRun submits has a `refId` we set. A transaction
  with no `refId`, or one that does not reconcile to an ArcRun action in
  the DB, is the signal.
- Alarm on transfers OUT of user wallets to addresses that are not ArcRun
  contracts and not the user's own withdrawal target.
- Alarm on wallet creation you did not initiate, and on any entity-secret
  re-registration.
- Rotate the API key on a schedule so a silently leaked key has a bounded
  life, whether or not you ever detect the leak.

### Rotation procedure

```text
1. API key: issue a new one in the Circle console, swap CIRCLE_API_KEY,
   restart, verify a wallet action succeeds, then revoke the old key.
   Cheap and low-risk. Do this routinely.
2. Entity secret: this is the heavy one. It is registered against the
   Circle account and governs the wallet set, so re-registering it is a
   custody operation, not an env swap. Read Circle's current entity-secret
   rotation docs FIRST and follow them exactly; a wrong move here can
   leave the wallet set unusable, which strands every email user's funds.
   Rehearse it against a testnet wallet set before touching production.
3. Never rotate the entity secret and the API key in the same change.
   Rotate one, verify a real user action end to end, then the other.
```

### Recovery / loss procedure

Credentials LOST (no backup, not leaked): every email operator's wallet is
now unreachable by ArcRun. The users cannot move their own funds either,
because they never had a key. This is the failure mode with no clean exit,
and it is the reason the entity secret needs a backup as disciplined as the
admin seed. Escalate to Circle support before doing anything improvisational.

Credentials LEAKED: assume user funds are being drained right now.

1. Revoke the API key in the Circle console. It is the fastest lever and it
   cuts the attacker's access immediately.
2. Only then work out what moved, from the Circle transaction feed
   reconciled against the DB.
3. Rotate the entity secret per Circle's documented procedure.
4. This is a user-funds incident. Assume disclosure obligations, and treat
   the migration off custodial wallets as urgent rather than planned.

---

## Annual review checklist

Once a year, walk this doc end-to-end and verify:

- [ ] Storage location of each key is still correct (people change
      laptops, hardware wallets get retired).
- [ ] Backup access still works: try recovering each key from its
      backup in a sandbox.
- [ ] Monitoring alarms still fire: push a synthetic event and confirm
      the on-call channel gets pinged.
- [ ] The wallet-separation boot check still flags the simulated
      collision (run with two roles set to the same key in a staging
      env; coordinator should refuse to start under
      `STRICT_WALLET_SEPARATION=true`).
- [ ] `contracts/deployments/arc-testnet.json` (and the mainnet file
      once it exists) matches the current live key set.
- [ ] The nanopay wallet's mainnet balance and Gateway balance are both
      still sized for days of research, not months, and both still
      reconcile to `nanopayments` rows.
- [ ] The Circle entity secret backup still exists and is still recoverable
      by more than one person. Losing it strands every email user.
- [ ] The secrets NOT covered by the boot check (nanopay wallet, Circle
      credentials) are still distinct from every other key. Nothing warns
      you at boot if they are not.

The doc itself goes in version control. The keys do not.
