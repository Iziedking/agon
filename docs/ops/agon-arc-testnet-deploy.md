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
