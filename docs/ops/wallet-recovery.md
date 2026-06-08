# Wallet recovery runbook

The on-call doc for when a production key is lost, leaked, rotated, or
needs an emergency revoke. Five wallets hold ArcRun's production
responsibilities; this file says what each can do, where it lives, what
breaks if it's compromised, and how to swap it without taking the
platform down.

Pair this with the automated `checkWalletSeparation()` boot check in
`backend/src/coordinator/walletCheck.ts`, which flags collisions but does
not tell you what to do when one happens.

---

## Quick reference

| Wallet | On-chain role | Held by | Lose it → |
|---|---|---|---|
| **admin** | `DEFAULT_ADMIN_ROLE` on all six contracts | Hardware wallet (cold) | Total freeze. Redeploy required. |
| **treasury** | Recipient of listing fees + platform-fee skims | Hardware wallet (cold) | Fees route to dead address until admin re-targets. Old funds stuck. |
| **coordinator** | `COORDINATOR_ROLE` on ContestEngine, ChallengeArena, SyndicateFactory, PointsLedger | KMS / HSM (warm) | Contests stop opening + settling. Admin grants role to new key. |
| **validator** | Implicit (caller of `ReputationRegistry.giveFeedback`) | KMS / HSM (warm) | ERC-8004 feedback stops. In-game scoring keeps working. Swap key. |
| **scout-master** | Mnemonic deriving all Scout hot wallets | KMS / sealed envelope | Hot wallet funds at risk if leaked. Sweep, regenerate, swap env. |

Cold = air-gapped, used only for governance operations (a few times a
year). Warm = signing service callable from the backend (signs many txs
per day).

---

## 1. admin

### Role and powers

The single most powerful key on the platform. Holds `DEFAULT_ADMIN_ROLE`
on every contract:

- `PrizeEscrow` — grant `CONTROLLER_ROLE`, set treasury via
  `setTreasury()`, sweep unclaimed.
- `AgentRegistry` — grant `CONTEST_ENGINE_ROLE`, set treasury, set
  upgrade prices.
- `ContestEngine` — grant `COORDINATOR_ROLE`, set listing fee, set
  default platform fee bps (capped at 20%), cancel any contest.
- `ChallengeArena` — grant `COORDINATOR_ROLE`, cancel challenges.
- `SyndicateFactory` — grant `COORDINATOR_ROLE`.
- `PointsLedger` — grant `COORDINATOR_ROLE` and `CONTEST_ENGINE_ROLE`.

The admin key cannot directly steal user funds (claims are pull-based,
gated by merkle proofs) but it can drain the treasury via
`PrizeEscrow.sweepUnclaimed()` after the 30-day window, and it can
re-route future fees by changing the treasury address.

### Storage

Cold storage only — hardware wallet (Ledger / Trezor) plus a sealed
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
   the same address — a no-op that proves the role works).
4. From the OLD admin, for each contract:
     renounceRole(DEFAULT_ADMIN_ROLE, OLD_ADMIN)
5. Wipe the old hardware wallet.
6. Update contracts/deployments/arc-testnet.json `roles.admin` to the
   new address.
```

Never `revokeRole` the old admin from the new admin in the same tx
sequence — `renounceRole` from the old key is the standard OpenZeppelin
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

No on-chain role — treasury is just an address stamped into each
contract's storage. It can spend USDC freely (standard EOA powers).

### Storage

Cold storage. Multi-sig recommended once revenue is non-trivial: a 2-of-3
Safe across founders / counsel / ops. Pre-Safe, a hardware wallet with
the seed in a separate vault is sufficient.

### Blast radius if compromised

Attacker can transfer the USDC balance to their own address. They cannot
re-route future fees (admin does that). They cannot freeze the platform.

### Detection

Watch USDC `Transfer(treasury, *, value)` events. Any outbound transfer
not initiated by an ops-approved tx is a compromise. A balance-tracking
dashboard with a daily snapshot makes drift obvious.

### Rotation procedure

```text
1. Generate the new treasury wallet.
2. From the ADMIN, for each contract that stores treasury:
     PrizeEscrow.setTreasury(NEW_TREASURY)
     AgentRegistry.setTreasury(NEW_TREASURY)
   (ContestEngine and ChallengeArena read treasury from PrizeEscrow at
    skim time, so the PrizeEscrow setter covers them.)
3. From the OLD treasury, transfer the remaining USDC balance to NEW.
4. Update contracts/deployments/arc-testnet.json `roles.treasury`.
```

No downtime — future fees route to the new address from the block
`setTreasury` lands. Past fees in the old address must be moved manually.

### Recovery / loss procedure

If treasury is lost but admin is intact:

1. From admin, `setTreasury(NEW_TREASURY)` on `PrizeEscrow` and
   `AgentRegistry`. Future fees route to the new address.
2. Accept that USDC currently sitting at the dead treasury address is
   stranded forever.
3. Audit how the key was lost; tighten storage before mainnet relaunch.

---

## 3. coordinator

### Role and powers

The orchestration key. Holds `COORDINATOR_ROLE` on:

- `ContestEngine` — `postScoreRoot()`, `settle()`, `cancelContest()`.
- `ChallengeArena` — `postWinnerRoot()`, `cancelChallenge()`.
- `SyndicateFactory` — `settleWeeklyWar()`.
- `PointsLedger` — `credit()`.

Off-chain it also:

- Funds Scout hot wallets via `fundHotWallets()` (using the
  coordinator's USDC balance, not protocol funds).
- Sweeps hot wallets after settlement via `sweepHotWallets()`.
- Pays listing fees and pool funding when opening platform-funded
  contests in autopilot mode.

The coordinator wallet holds two pools of USDC:

- A platform float for pool funding + Scout topups (operationally
  large, often 100s of USDC at a time).
- The gas float (USDC is native gas on Arc, so balance = gas).

### Storage

Warm wallet — KMS-backed signing service (AWS KMS, GCP Cloud KMS, or a
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
balance is loaded — this is not protocol funds, but it is ArcRun's
working capital).

Time to drain: one tx per contest. With ~5 live contests, ~5 txs.

### Detection

Watch the indexer for:

- `ContestScored` or `ContestSettled` events that were not preceded by
  a runner result in the coordinator's logs.
- `Transfer(coordinator, *, value)` USDC events where the recipient is
  not a known hot-wallet derivation, a contract, or treasury.

Alarm on these in real time, not daily — a fake-settle attack can be
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
holds no on-chain role — its authority comes from the no-self-feedback
rule: the registry rejects feedback where the caller owns the agent
NFT. AgentRegistry owns all ArcRun agent NFTs, so any non-AgentRegistry
EOA can validate them — but the validator must not collide with the
coordinator (because the coordinator's key is what AgentRegistry uses
internally; the rejection rule is more subtle than just "must not be
the NFT owner address", so keep them distinct).

### Storage

Warm wallet, same KMS pattern as coordinator. The validator signs a few
txs per contest settlement; load is modest.

### Blast radius if compromised

Attacker can post arbitrary `giveFeedback()` calls — fake wins for
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
agentId })`. Each derived wallet:

- Receives USDC from the coordinator before a Scout contest
  (`fundHotWallets`).
- Executes real on-chain USDC transfers during the contest (the
  Scout runner's "volume" work).
- Returns leftover USDC to the coordinator after settlement
  (`sweepHotWallets`).

Hundreds or thousands of derived wallets may exist over time; only the
mnemonic is stored. Each `addressIndex` is deterministic from the
mnemonic.

### Storage

Sealed envelope split into multi-party shares (Shamir secret sharing,
or a manual k-of-n split written on paper). The mnemonic is read
ONCE at backend start, kept in memory only, never written to disk
outside the env file (which itself is gitignored).

For mainnet, replace with a KMS-derived signing service that hands out
per-agent signers without exposing the mnemonic. This is a
non-trivial refactor; on testnet, a sealed envelope is acceptable.

### Blast radius if compromised

Every Scout hot wallet — past, present, and future — is at risk. An
attacker with the mnemonic can derive any `addressIndex` and drain
whatever USDC is sitting there. Typical balance per wallet is small
(1-5 USDC) but the total across an active platform is meaningful.

Crucially, attackers cannot touch agent ownership (that's `AgentRegistry`
storage, not the hot wallet) and cannot affect the on-chain payout
flow. They just steal Scout float.

### Detection

Daily aggregate-balance snapshot of the first ~1000 derived addresses.
A drop without a corresponding settlement run is compromise.

### Rotation procedure

```text
1. Stop the coordinator (prevents new Scout funding while rotating).
2. Sweep every derived hot wallet back to the coordinator using the
   OLD mnemonic via a one-off script (extend sweepHotWallets to walk
   addressIndex 0..N).
3. Generate a new mnemonic. Seal and split it before continuing.
4. Swap SCOUT_MASTER_MNEMONIC env.
5. Restart the coordinator. checkWalletSeparation() logs the new
   scout-master[0] address.
6. Next Scout contest funds new hot wallets at the new mnemonic's
   derivations. Old wallets are now orphan (zero balance, no scheduled
   funding).
```

### Recovery / loss procedure

Mnemonic gone but coordinator intact:

1. All currently-funded hot wallets are now permanently inaccessible to
   ArcRun. Their USDC is stranded (literally lost — no one holds the
   key). Audit how much is locked up.
2. Generate a new mnemonic and swap env per the rotation steps.
3. Continue operating. Future Scout contests use the new mnemonic; old
   wallets are dead.

The platform survives mnemonic loss; only the small per-wallet floats
are stranded.

---

## Annual review checklist

Once a year, walk this doc end-to-end and verify:

- [ ] Storage location of each key is still correct (people change
      laptops, hardware wallets get retired).
- [ ] Backup access still works — try recovering each key from its
      backup in a sandbox.
- [ ] Monitoring alarms still fire — push a synthetic event and confirm
      the on-call channel gets pinged.
- [ ] The wallet-separation boot check still flags the simulated
      collision (run with two roles set to the same key in a staging
      env; coordinator should refuse to start under
      `STRICT_WALLET_SEPARATION=true`).
- [ ] `contracts/deployments/arc-testnet.json` (and the mainnet file
      once it exists) matches the current live key set.

The doc itself goes in version control. The keys do not.
