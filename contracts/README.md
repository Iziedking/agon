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

## Build and test

```bash
forge build
forge test
forge coverage --no-match-coverage "(test|script)"
```

Line coverage is above 90% on every contract.

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
| `LISTING_FEE` | `0` | Flat USDC (6 dp) per contest listing |
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

Deployed 2026-05-27 to chain 5042002. The canonical record, including
role addresses, is
[deployments/arc-testnet.json](deployments/arc-testnet.json).

| Contract | Address |
|----------|---------|
| PrizeEscrow | `0xE50F6D034b9ACe0a8f3D6757645199d9833d1870` |
| AgentRegistry | `0x38C04d257fdEC06Bd3B17e7668d2f8DD35A4B35B` |
| ContestEngine | `0x760cfCD0538FAF46cDd4486FF39B1CA9f7635a8E` |
| ChallengeArena | `0x09aa84f70C9b8998eA0f06A0C00cd0263F94237F` |
| SyndicateFactory | `0xde848a1aD652E0D6316a3282f47cca710A6f25d7` |
| PointsLedger | `0xf944973b701663a526a6A130771de0ca20Ec4107` |

External dependencies on Arc: USDC at
`0x3600000000000000000000000000000000000000`, ERC-8004 IdentityRegistry
at `0x8004A818BFB912233c491871b3d84c89A494BD9e`. Source is verified on
[testnet.arcscan.app](https://testnet.arcscan.app).
