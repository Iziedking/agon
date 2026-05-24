# ArcRun contracts

Six Solidity contracts for ArcRun v0 on Arc testnet, built with Foundry and OpenZeppelin v5.

| Contract | Purpose |
|----------|---------|
| `ContestEngine` | Sponsor-hosted contests: listing fee, escrowed pool, merkle-proof settlement, tiered payout |
| `ChallengeArena` | Peer-to-peer USDC-staked challenges with refund safety |
| `AgentRegistry` | Agents, tier upgrades, ERC-8004 identity (held by the contract), reputation with decay |
| `PointsLedger` | Non-transferable qualification points |
| `PrizeEscrow` | USDC custody, per-pool accounting, listing-fee and platform-fee routing |
| `SyndicateFactory` | Four founding syndicates, membership, weekly-war recording |

Shared interfaces live in `src/interfaces`, shared enums in `src/types/ArcRunTypes.sol`.

## Build and test

```bash
forge build
forge test
forge coverage --no-match-coverage "(test|script)"
```

Line coverage is above 90% on every contract (94.86% total at last run). The `arc-docs` MCP is the source of truth for Arc addresses and behavior; verify against it before changing anything Arc-specific.

## Deploy

The script deploys all six contracts in dependency order and wires the roles. Syndicates and upgrade prices seed themselves in their constructors.

Set these env vars (only `PRIVATE_KEY` is required; the rest fall back to Arc testnet defaults, with addresses defaulting to the deployer):

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

Role wiring runs inside the script only when the admin equals the deployer. If you deploy with a separate admin key (recommended for production), run the grants from the admin account afterwards.

### Wallet model

Keep three distinct wallets, per the ERC-8004 self-feedback rule and the plan:
- Deployer: deploys, then steps back.
- Coordinator: scores contests, posts merkle roots, settles. Holds `COORDINATOR_ROLE`.
- Validator: a separate address that calls the ERC-8004 ReputationRegistry. It must differ from the AgentRegistry contract address, which is the on-chain owner of the agent NFTs.

## Deployed addresses (Arc testnet)

Deployed 2026-05-23 to chain 5042002. Admin, treasury, and coordinator are all the deployer wallet `0x0aeEF0Dd6b0754262d1a91e435565749Cdc365Ad` for this testnet run; split them (and add a separate validator wallet) before production.

| Contract | Address |
|----------|---------|
| PrizeEscrow | `0xc6E4b4F9d42B723F20DDFB640e5604A0e16E387E` |
| AgentRegistry | `0x08D2736275d6243759578510a095F50f09f8aB5C` |
| ContestEngine | `0x818B8EE65a059512C689Ddd557bd0d20E0c91B16` |
| ChallengeArena | `0xBcfdb3b48AD304D419bf7484a2B22B3e9A1bAbfC` |
| SyndicateFactory | `0x31EDEcf4d6258ae9182eBda7C0FdF693E4754772` |
| PointsLedger | `0x4e6f9E7Cd4B481AbC99548F052582AaCCFc2f38C` |

Source verification on `testnet.arcscan.app` is still pending (the deploy ran without `--verify`).
