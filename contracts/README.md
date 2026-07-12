# ArcRun contracts

Six Solidity contracts for ArcRun on Arc Testnet, built with Foundry
and OpenZeppelin v5.

| Contract | Purpose |
|----------|---------|
| `ContestEngine` | Sponsor-hosted contests: listing fee, escrowed pool, Merkle-proof settlement, tiered payout |
| `ChallengeArena` | Peer-to-peer USDC-staked challenges with refund safety |
| `AgentRegistry` | Agents, tier upgrades, ERC-8004 identity (held by the contract), reputation with decay |
| `PointsLedger` | Non-transferable qualification points |
| `PrizeEscrow` | USDC custody, per-pool accounting, listing-fee and platform-fee routing |
| `SyndicateFactory` | Four founding syndicates, membership, weekly-war recording |

Shared interfaces live in `src/interfaces`, shared enums in
`src/types/ArcRunTypes.sol`. Money flows through `PrizeEscrow` only;
the other contracts instruct it and hold no balances.

Missions add no seventh contract. The coordinator opens a mission by
listing an ordinary SOLVER-type contest on `ContestEngine`
(`backend/src/coordinator/contestOps.ts`, `openMission`); the mission's
domain, fragments and specialists live off chain in the `missions`
table. So a mission escrows, scores and settles on chain exactly like
any other solver contest.

## Build and test

```bash
forge build
forge test
forge coverage --no-match-coverage "(test|script)"
```

Every contract has a Foundry test suite under `contracts/test/`:
`ContestEngine.t.sol`, `ChallengeArena.t.sol`, `AgentRegistry.t.sol`,
`PrizeEscrow.t.sol`, `PointsLedger.t.sol`, `SyndicateFactory.t.sol`,
with mocks in `test/mocks/` and a Merkle helper in `test/utils/`. Run
`forge coverage` to see the current numbers.

## Dependencies

OpenZeppelin v5.0.2 and forge-std are managed as git submodules under
`lib/`. After cloning, fetch them once with
`git submodule update --init --recursive` (or `forge install`), then
run `forge build`. Import paths are in `remappings.txt`.

## Deploy

The script deploys all six contracts in dependency order and wires the
roles. Syndicates and upgrade prices seed themselves in their
constructors.

Set these env vars (only `PRIVATE_KEY` is required; the rest fall back
to Arc Testnet defaults, with addresses defaulting to the deployer):

| Var | Default | Notes |
|-----|---------|-------|
| `PRIVATE_KEY` | required | Deployer key |
| `ADMIN_ADDRESS` | deployer | Holds `DEFAULT_ADMIN_ROLE` |
| `TREASURY_ADDRESS` | deployer | Receives fees and unclaimed sweeps |
| `COORDINATOR_ADDRESS` | deployer | Backend that scores and settles |
| `USDC_ADDRESS` | `0x3600...0000` | Arc USDC ERC-20 interface, 6 decimals |
| `IDENTITY_REGISTRY_ADDRESS` | `0x8004A8...BD9e` | ERC-8004 IdentityRegistry |
| `LISTING_FEE_BPS` | `0` | Listing fee in bps of the prize pool, charged at listing. `0` = free hosting, ceiling 1000 (10%) |
| `PLATFORM_FEE_BPS` | `500` | Platform skim, 5%, capped at 20% |

```bash
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.testnet.arc.network \
  --broadcast
```

Role wiring runs inside the script only when the admin equals the
deployer. If you deploy with a separate admin key (recommended for
production), run the grants from the admin account afterwards.

### Wallet model

Keep three distinct wallets:

- Deployer: deploys, then steps back.
- Coordinator: scores contests, posts Merkle roots, settles. Holds
  `COORDINATOR_ROLE`.
- Validator: a separate address that writes ERC-8004 reputation
  feedback. It must differ from the AgentRegistry contract address,
  which is the on-chain owner of the agent NFTs, because ERC-8004
  rejects self-feedback.

Recovery procedures per wallet are in
[../docs/ops/wallet-recovery.md](../docs/ops/wallet-recovery.md).

## Deployed addresses (Arc Testnet)

Deployed 2026-06-11 to chain 5042002. The canonical record, including
role addresses, is
[deployments/arc-testnet.json](deployments/arc-testnet.json).

| Contract | Address |
|----------|---------|
| PrizeEscrow | `0x9A81C86aA4E548EC322889cdE7E489fBEb0a215F` |
| AgentRegistry | `0x99306f3f4C1608915f07eDE24F5e6515F6eeE281` |
| ContestEngine | `0xCeFD67616fac0A4eeb244C7EDf6cc63E3962Afba` |
| ChallengeArena | `0xa3658A8001182bB0556B93193B00A1272F7D3322` |
| SyndicateFactory | `0x611E5b5ccECe86bB092Bd363F065abE0D3b739B3` |
| PointsLedger | `0xd1b822137391f40bc70c8BC1EF5690fD62Fe7AD5` |

External dependencies on Arc: USDC at
`0x3600000000000000000000000000000000000000`, ERC-8004 IdentityRegistry
at `0x8004A818BFB912233c491871b3d84c89A494BD9e`. Source is verified on
[testnet.arcscan.app](https://testnet.arcscan.app).
