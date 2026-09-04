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
npm run test:lp-agent
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
readiness, job/receipt reads, and AGON LP Guardian's read-only PancakeSwap
position analysis. Payment approval, paid hiring, third-party task execution,
automatic liquidity changes and settlement writes remain disabled. No end-to-end paid result
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
| `BNB_LP_AGENT_DAILY_LIMIT` | Global public LP analysis allowance per UTC day, default 100; 0 pauses new runs |

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

## AGON-operated LP Guardian

Open `/agon/playground?network=bnb-testnet`. Enter a PancakeSwap v3 position
NFT ID, not an ERC-8004 agent ID. This service reads the actual position,
factory-derived pool and 10-minute oracle at one BNB Testnet block. It returns
hold, a tick-aligned range proposal for review, or an explicit refusal.
The range rule is deterministic; no model controls funds. It does not move
liquidity, choose an optimal strategy, estimate returns or protect against
every form of price manipulation.

This is an AGON-operated analysis service, not a fabricated registered agent.
Its public ERC-8004 registration and paid hiring are not configured yet.
It is separate from the third-party registry catalog. This first capability
alone does not satisfy the four-category marketplace or automated rebalancing
requirements.

Runs persist in PostgreSQL before chain reads. Refreshing the result URL
restores the report. Reusing the same UUID with the same inputs does not
execute twice; changed inputs require a new UUID. Interrupted requests are
reported honestly, with no automatic replay. Downloaded report bytes have a
SHA-256 hash shown beside the result. This checks artifact integrity, not an
independent verification signature or a settlement receipt.

Public task endpoint: `POST /api/bnb/97/providers/lp-guardian/runs` with
`{ "runId": "<version-4 UUID>", "input": { "positionId": "<NFT ID>",
"halfWidthSteps": 10, "maxDeviationTicks": 100 } }`. Browser POST requests
must include their same-site Origin. Retrieve a saved run at that path
followed by `/{runId}`. Capability description:
`GET /api/bnb/97/providers/lp-guardian`. Chain 56 refuses execution.

Limits are shared across instances: 100 admitted runs per UTC day by default,
5 per minute and 2 concurrent. Each run has a 45-second response deadline;
the host must allow 60-second functions. RPC retries are bounded. Public
callers can exhaust this free allowance, so monitor usage before a public demo.
No model API or wallet spend is used. Position data and reports are public;
do not submit private information. Database retention follows the operator's
backup policy; run IDs never expire into reusable idempotency keys.

To verify the real service without a browser:

```bash
npm run test:lp-agent
npm run prove:lp-agent -- 37235
```

Position `37235` was discovered through the official Testnet manager's NFT
enumeration on September 4, 2026. It is a public read example, not an AGON-owned
position, and its state may change. Supply your own current position ID.
The proof command uses the real read adapter; it never signs or broadcasts.
For isolated database tests, `npm run test:lp-storage` uses the local test
Postgres at `127.0.0.1:15432`, creates a unique temporary schema, and removes
only that schema after the test. Do not point tests at production.

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
- [PancakeSwap v3 deployments](https://developer.pancakeswap.finance/contracts/v3/addresses)
- [PancakeSwap v3 interfaces and oracle rules](https://github.com/pancakeswap/pancake-v3-contracts)

The deployment address file takes precedence over the upstream README.
An older provider policy must not be accepted automatically when it differs
from the pinned deployment or is no longer whitelisted onchain.
