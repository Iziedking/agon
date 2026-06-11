# Progress and ops levers

A running list of things we can do as the project moves, with the exact
command for each. Admin actions are signed by the deploy admin wallet
(`0x0aeE…65Ad`, key on line 13 of `backend/.env`); pass it as
`ADMIN_PRIVATE_KEY` and never paste it into a committed file. The admin
wallet needs a little USDC for gas (USDC is Arc's gas token).

Live contract addresses are the source of truth in
`contracts/deployments/arc-testnet.json`. The scripts below read from there,
so they keep working across redeploys.

## Economy levers

### Listing fee (percentage of pool, 0% by default)

Hosts pay this up front to list a campaign, on top of funding the pool. It
is a percentage of the pool, capped at 10%. Free at 0%.

```bash
cd contracts
ADMIN_PRIVATE_KEY=0x... ./scripts/set-listing-fee.sh 1.5   # 1.5%
ADMIN_PRIVATE_KEY=0x... ./scripts/set-listing-fee.sh 0     # back to free
```

### Platform fee (settlement skim, 5% now)

The cut taken from every settled pool. Admin-set, capped at 20%. No script
yet; one-liner:

```bash
cast send <ContestEngine> "setDefaultPlatformFeeBps(uint16)" 500 \
  --rpc-url https://rpc.testnet.arc.network --private-key 0x<ADMIN>
# 500 = 5%. Same setter exists on ChallengeArena.
```

## Admin / safety levers

### Pause / unpause (emergency stop)

Blocks new listings, entries, and claims on the engine. Settlement and
recovery stay open. Both ContestEngine and ChallengeArena.

```bash
cast send <ContestEngine> "pause()"   --rpc-url <RPC> --private-key 0x<ADMIN>
cast send <ContestEngine> "unpause()" --rpc-url <RPC> --private-key 0x<ADMIN>
```

### Agent cap

Default 6 per owner. Change with:

```bash
cast send <AgentRegistry> "setMaxAgentsPerOwner(uint16)" 6 \
  --rpc-url <RPC> --private-key 0x<ADMIN>
```

### Enable custom syndicate creation

Off by default (only the four founding syndicates). Turn on the v1 feature:

```bash
cast send <SyndicateFactory> "setCustomCreationEnabled(bool)" true \
  --rpc-url <RPC> --private-key 0x<ADMIN>
```

## Contract ops

### Verify contracts on arcscan

Helper at `backend/scripts/verify-contracts.ts` reads the deployments file,
encodes constructor args, and prints `forge verify-contract` commands.
Dry-run by default; set `VERIFY_RUN=1`, `VERIFIER_URL=…`, `ETHERSCAN_API_KEY=any`
to execute. Pass `LISTING_FEE_BPS` / `PLATFORM_FEE_BPS` if non-default were
used at deploy.

### Redeploy contracts

Needs `coordinator != treasury` (M1 guard) and `admin == deployer` so the
in-script role grants run.

```bash
cd contracts
PRIVATE_KEY=0x<deployer> ADMIN_ADDRESS=0x<admin> \
COORDINATOR_ADDRESS=0x<coordinator> TREASURY_ADDRESS=0x<treasury> \
LISTING_FEE_BPS=0 \
forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
```

After any redeploy, sync addresses in all five places:
`contracts/deployments/arc-testnet.json`, `frontend/src/lib/arc.ts`,
`README.md`, `contracts/README.md`, and the deployment memory. Then set
`START_BLOCK=<deploy block>` in `deploy/.env` (and local `backend/.env` if
you run the stack there) so the indexer scans from the fresh deploy.

## Backups (prod VPS)

Daily cron runs `deploy/backup.sh`. Pull a copy off the box:

```bash
scp arcrun@<VPS_IP>:/opt/arcrun/backups/arcrun-db-*.sql.gz .
scp arcrun@<VPS_IP>:/opt/arcrun/backups/arcrun-files-*.tar.gz .
```

Restore on a box with `deploy/restore.sh` (see `deploy.md`).
