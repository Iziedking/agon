# ArcRun backend

Node and TypeScript services for ArcRun on Arc Testnet: an indexer, an
auth and API service, a coordinator, and the four agent runners. They
read deployed contract addresses from
`../contracts/deployments/arc-testnet.json`.

## Services

| Service | Entry | What it does |
|---------|-------|--------------|
| Indexer | `npm run indexer` | Polls the contracts (and Arcana Markets) with `eth_getLogs`, writes raw events to `events_log`, and maintains the denormalized read tables. Resumes from the last processed block. |
| Auth / API | `npm run auth` | SIWE wallet login, email login (one-time code, passkey, Circle Developer-Controlled wallet), JWT sessions, backend-signed wallet routes, payout proofs, results, and optional X / Discord / Telegram linking. |
| Coordinator | `npm run coordinator` | BullMQ scheduler, serialized Arc transaction sender (EIP-1559), agent runners, Merkle settlement, WebSocket standings fanout, autopilot. |

## Stack

viem, Hono, pg (Postgres 16), ioredis and BullMQ (Redis 7), ws, jose,
zod, siwe, `@simplewebauthn/server`. Models come from the Anthropic SDK
(`@anthropic-ai/sdk`) and from OpenRouter over its OpenAI-compatible
endpoint (`OPENROUTER_API_KEY`), which backs tiers 0 to 3. Circle
packages: `@circle-fin/app-kit`, `@circle-fin/adapter-viem-v2`,
`@circle-fin/adapter-circle-wallets`,
`@circle-fin/developer-controlled-wallets`, `@circle-fin/swap-kit`,
`@circle-fin/provider-stablecoin-service-swap` and
`@circle-fin/x402-batching`. x402 payments also use `@x402/core`,
`@x402/evm` and `x402-fetch`.

## Setup

```bash
docker compose up -d        # Postgres on 5434, Redis on 6380
cp .env.example .env        # fill in the values marked <fill in>
npm install
npm run migrate             # create tables
```

Host ports are 5434 (Postgres) and 6380 (Redis) to avoid clashing with
local defaults. Other ports: auth 8082, WebSocket 8788.

## Run

```bash
npm run indexer             # one pass with INDEXER_ONCE=1, otherwise follows head
npm run auth
npm run coordinator         # needs COORDINATOR_PRIVATE_KEY to send; otherwise log-only
npm run typecheck
```

## Runners

Four runner families live in `src/runners` and share the LLM client and
the scoring module:

- **Solver** generates a seeded puzzle set per contest and grades on
  correctness and speed. Every entrant faces identical puzzles.
- **Analyst** trades live binary markets on Arcana Markets with real
  USDC from per-agent wallets. A tick scheduler spreads each agent's
  decision budget across the trade window; scoring is PnL.
- **Scout** derives a hot wallet per agent from `SCOUT_MASTER_MNEMONIC`
  and executes tier-capped USDC operations on Arc; scoring is volume.
- **Missions** (`src/runners/missions/`) runs each operative through a
  make-or-buy loop: pay an x402 service for a data fragment, or pay a
  specialist agent for it over an on-chain A2A transfer, then synthesize
  a deliverable that the grader scores. A mission is a SOLVER-type
  contest, so `runContestById` dispatches to `MissionRunner` when the
  contest has a row in the `missions` table.

Tier does two things. It picks the model (`src/runners/llm/tierConfig.ts`,
`modelForTier`): by default tier 0 is `meta-llama/llama-3.2-1b-instruct`,
tier 1 `meta-llama/llama-3.2-3b-instruct`, tier 2
`meta-llama/llama-3.1-8b-instruct`, tier 3 `openai/gpt-4o-mini`, tier 4
`claude-haiku-4-5-20251001`. Tiers 0 to 3 are OpenRouter slugs, tier 4 is the
Anthropic id, and each is overridable with `TIER0_MODEL` through
`TIER4_MODEL` (`LLM_MODEL_TIER4` still wins for tier 4). It also gates
capability in the contest runners: tier 0 and 1 skip the LLM and guess,
tier 2 calls the model, tier 3 adds code execution, tier 4 adds web
search. Missions call the tier's model at every tier.
`LLM_DAILY_KILL_USD` hard-stops LLM spend for the day when exceeded.
Every call is audited in `llm_runs`.

## Research micropayments

Agents at tier 3 and above buy outside data mid-run through x402 (HTTP
402) micropayments settled in USDC: prediction-market data and web
search for the Solver, sentiment-tagged news for the Analyst, spot
prices for the Scout. The shared gate in `src/nanopayments/research.ts`
enforces the tier threshold, per-call caps, and a session budget per
tier. Every payment writes a row to `nanopayments` and surfaces on the
live stage.

The sellers are external x402 services and they settle on their own
chains, Base and Polygon, not on Arc. The paying wallet therefore needs
USDC there, and the settlement tx hash a payment writes to
`nanopayments` is a Base or Polygon hash. Arc stays the chain for
contests, prizes and A2A transfers.

`NANOPAY_PROVIDER` picks how a payment is made
(`src/nanopayments/index.ts`), and the default is `cli`:

- `cli` shells out to `circle services pay`, so the Circle CLI must be
  installed (`npm i -g @circle-fin/cli`) and logged in on the host.
- `sdk` pays in process, signing from `NANOPAY_WALLET_PRIVATE_KEY`. No
  CLI, so it works in a slim container.
- `exact` pays the standard x402 "exact" scheme over `@x402/core` and
  `@x402/evm`, signing from the same key. This is the path for sellers
  like Exa and Gloria.
- `auto` resolves the path per seller from the host, probing an unknown
  host's 402 response once and caching the verdict, so one mission round
  can pay several services correctly.

Set `NANOPAY_ENABLED=1` and the rest of the `NANOPAY_*` variables
described in `.env.example`. When `NANOPAY_HTTP_FALLBACK` is on and a
paid call cannot complete, the runner fetches the endpoint over plain
HTTPS so the agent still gets data; no USDC moves and the row is marked
accordingly.

## Settlement

The coordinator turns runner results into a tiered `(operator, amount)`
payout Merkle tree (`src/coordinator/merkle.ts`, `payouts.ts`), posts
the root on chain, and serves claim proofs over the API. The full
open-to-claim loop runs on testnet around the clock under the
autopilot.

## Admin console

The auth service serves the `/admin` routes behind `ADMIN_TOKEN`: every
one of them wants that token in the `x-admin-token` header, and they all
return 503 when it is unset. The frontend `/admin` page is the console
on top of them. Between them they cover:

- Traction and members: an overview of the live numbers, the operator
  list, and the event and error log the clients and services append to.
- Settlement audit: for a contest or a challenge, recompute the payout
  Merkle root from the persisted payouts and compare it with the root
  posted on chain. A separate view lists the A2A and x402 payments the
  mission economy has settled.
- Ops: queue a command for the coordinator to pick up (settle a contest,
  resolve or cancel a challenge, cancel a contest, refund or clear
  missions, open a mission on demand), delist an agent, and read the
  mission config, the Arcana state and the custom-mission requests.
- Treasury: withdraw collected fees, signed by `TREASURY_PRIVATE_KEY`
  (the coordinator is a different wallet and cannot move treasury
  funds).

## Notes

- Secrets live in `.env` (gitignored): `JWT_SECRET`,
  `COORDINATOR_PRIVATE_KEY`, `VALIDATOR_PRIVATE_KEY`,
  `TREASURY_PRIVATE_KEY` (signs the mission join-fee refunds in
  `src/runners/missions/fees.ts` and the treasury withdrawal),
  `SCOUT_MASTER_MNEMONIC`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`,
  `ADMIN_TOKEN`, Circle credentials, and OAuth keys. Contract addresses
  are public and come from the committed deployments file.
- Social OAuth routes return 501 until their credentials are set.
- The indexer is idempotent and resumable: it tracks the last processed
  block in `indexer_state` and de-dupes on `(tx_hash, log_index)`.
- The coordinator refuses to start in strict mode if the coordinator
  and validator wallets are the same address.
