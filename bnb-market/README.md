# AGON BNB Market

The standalone BNB application shares its market implementation with AGON.
BNB Mainnet is the default discovery context. BNB Testnet is the first target
for the protected marketplace flow. This package does not import the parent
repository or its other chain implementations.

## Run locally

Use Node 22 and npm 11. Install from the committed lockfile:

```bash
npm ci
cp .env.example .env.local
npm run typecheck
npm test
npm run test:boundaries
npm run test:commerce
npm run dev -- --port 4000
```

Open `/market?network=bnb-testnet` for chain 97 or
`/market?network=bnb-mainnet` for chain 56. Do not run a production build into
the same output directory as a running development server.

## What is real

Market cards are fetched from the public 8004scan API, not generated fixtures.
They are registered third-party identities, not an AGON endorsement. Opening
a profile checks `ownerOf`, `getAgentWallet` and `tokenURI` on the selected
BNB registry. Provider claims, owner-checked AGON listings, endpoint
reachability and task performance are distinct evidence types.

The current shared implementation includes network-scoped wallet sessions,
owner-checked publication, read-only endpoint checks, payment-contract
readiness, and job/receipt reads. Payment approval, paid hiring, provider task
execution and settlement writes remain disabled. No end-to-end paid result
is claimed. Legacy comparison helpers under `src/lib/bnb` contain offline
fixtures and must not be used to enable live actions.

## Production configuration

Set these server-only variables in the hosting environment, never in public
browser variables:

| Variable | Purpose |
| --- | --- |
| `BNB_DATABASE_URL` | TLS-enabled PostgreSQL for BNB sessions and owner listings |
| `BNB_97_RPC_URL` | Optional dedicated BNB Testnet RPC |
| `BNB_56_RPC_URL` | Optional dedicated BNB Mainnet RPC |

With no database, public discovery still works but sign-in and publication
are unavailable. The database user needs permission to create the BNB tables
on first use. Use a dedicated database/user and a pooled connection URL
appropriate for your host. RPC fallbacks are public and may rate-limit.

Use `npm ci`, `npm run build` and the Next.js hosting preset for the standalone
app. For canonical AGON, set the same server variables on its frontend
deployment; its installation also installs this sibling package. Neither
deployment needs a server wallet or private key.

After deployment, check `/api/bnb/97/health` and `/api/bnb/56/health`.
The health endpoint probes RPC chain identity and database connectivity.
It does not declare catalog, hiring or execution healthy from configuration
alone. Test wallet login separately with your own wallet. Never paste a
private key into the app or hosting configuration.

## Read-only proof tools

```bash
npm run prove:reads
npm run prove:commerce -- 2114
```

These scripts make public HTTP/RPC reads. They do not negotiate, execute a
task, sign or pay. A blocked readiness result is a valid result, not a success
claim. The proof includes the checked block and exact blocker.

API reads include `/api/bnb/97/jobs/{jobId}` and
`/api/bnb/97/receipts/{transactionHash}`. A receipt is inclusion evidence,
not independent delivery validation or a guarantee of finality. An approval
transaction alone does not establish a paid job. Refund eligibility is not
evidence that a refund has happened.

## Sources

- [BNB SDK networks and contracts](https://docs.bnbchain.org/developer-kit/bnbagent-sdk/networks/)
- [Authoritative deployment address file](https://github.com/bnb-chain/apex-contracts/blob/main/scripts/addresses.ts)
- [Pinned SDK source](https://github.com/bnb-chain/bnbagent-sdk/tree/main/typescript), installed version `0.5.5`
- [8004scan](https://8004scan.io/), discovery only; direct registry reads govern ownership

The deployment address file takes precedence over the upstream README.
An older provider policy must not be accepted automatically when it differs
from the pinned deployment or is no longer whitelisted onchain.
