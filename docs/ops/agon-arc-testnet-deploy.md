# Agon Arc Testnet foundation deployment

This runbook deploys only the Agon marketplace foundation contracts. A dry run is not a deployment receipt, and a successful deployment does not mark any provider or listing as verified.

## Scope

- Network: Arc Testnet
- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.io`
- Gas token: native USDC
- External ERC-8004 `IdentityRegistry`: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- New contracts: `AgonProfileRegistry`, then `AgonServiceRegistry`

The deployment script refuses to run on another chain or when the configured identity registry has no bytecode.

## Configure the deployer

From `contracts`, copy `.env.example` to `.env` and edit it locally. Never put the private key on a command line or commit `.env`.

Required:

```text
PRIVATE_KEY=0x...
IDENTITY_REGISTRY_ADDRESS=0x8004A818BFB912233c491871b3d84c89A494BD9e
```

Optional:

```text
AGON_ADMIN_ADDRESS=0x...
```

When `AGON_ADMIN_ADDRESS` is absent, the deployer becomes the admin. Confirm that choice before broadcast.

## Preflight

Run these commands from `contracts`:

```text
forge fmt --check script/DeployAgonFoundation.s.sol src/AgonProfileRegistry.sol src/AgonServiceRegistry.sol src/interfaces/IERC8004Identity.sol test/AgonProfileRegistry.t.sol test/AgonServiceRegistry.t.sol
forge build
forge test
forge script script/DeployAgonFoundation.s.sol:DeployAgonFoundation --rpc-url arc_testnet -vv
```

Record the deployer, admin, predicted contract addresses, balance, nonce, gas estimate, and dry-run receipt. Check that both predicted addresses contain no code. Stop for explicit broadcast approval.

## Broadcast

Only after approval:

```text
forge script script/DeployAgonFoundation.s.sol:DeployAgonFoundation --rpc-url arc_testnet --broadcast -vv
```

Foundry writes the broadcast receipt to `broadcast/DeployAgonFoundation.s.sol/5042002/run-latest.json`. Treat any generated cache file marked sensitive as secret material and remove it after extracting the public receipt fields.

## Verify and record

For each transaction, require receipt status `1`, one finalized block, and non-empty deployed bytecode. Confirm these constructor relationships onchain:

- `AgonProfileRegistry`: admin and external `IdentityRegistry`
- `AgonServiceRegistry`: admin and deployed `AgonProfileRegistry`

Publish source through Arcscan's Blockscout verifier using the exact compiler and constructor arguments from the receipt. Then create `contracts/deployments/agon-arc-testnet.json` from the successful receipt. Do not copy predicted dry-run addresses into the canonical file.

Run the backend deployment parser tests, typecheck, contract tests, and marketplace capability checks after recording the real addresses.

`VERIFIER_ROLE` is intentionally not granted by the constructor. Grant it in a separate reviewed transaction only after the verifier address and operating policy are approved.

## Post-foundation Agon protocol preflight

`contracts/script/DeployAgonProtocol.s.sol` deploys the four new contracts
against the receipt-verified foundation. It checks Arc Testnet, deployed
bytecode for every dependency, foundation admin authorization, and the
ServiceRegistry-to-ProfileRegistry link before constructing anything.

Required local environment values are:

```text
AGON_PROFILE_REGISTRY_ADDRESS=0xE0c7A2545C2f4eE6d2bD797B6f2742c73E640574
AGON_SERVICE_REGISTRY_ADDRESS=0x2144C156B0a4581da2D046C2E41AC41C6C3938CB
AGON_USDC_ADDRESS=0x3600000000000000000000000000000000000000
AGON_VALIDATION_REGISTRY_ADDRESS=0x8004Cb1BF31DAf7788923b405b754f57acEB4272
AGON_DISPUTE_RESOLVER_ADDRESS=0x...
AGON_TREASURY_ADDRESS=0x...
AGON_DEFAULT_REVIEW_HOURS=24
```

Run the local checks first:

```text
forge fmt --check
forge build
forge test
forge script script/DeployAgonProtocol.s.sol:DeployAgonProtocol --rpc-url arc_testnet -vv
```

The final command is a dry run. Record the deployer, admin, dependency
addresses, nonce, balance, gas estimate, and four predicted addresses. Check
that each predicted address has no code. Do not add predicted addresses to
`contracts/deployments/agon-arc-testnet.json`.

Broadcasting is a separate, four-transaction external state change and
requires explicit approval of the exact constructor inputs and predicted
addresses:

```text
forge script script/DeployAgonProtocol.s.sol:DeployAgonProtocol --rpc-url arc_testnet --broadcast -vv
```

After a successful approved broadcast, require four successful receipts and
deployed bytecode, verify constructor relationships onchain, then append the
actual addresses and transaction receipts to the canonical deployment JSON.
The backend must remain disabled until that receipt update and the release
gate pass.
