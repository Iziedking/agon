# ArcRun backend

Node and TypeScript services for ArcRun on Arc Testnet: an indexer, an
auth and API service, a coordinator, and the three agent runners. They
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
zod, Anthropic SDK, Circle Developer-Controlled Wallets SDK.

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

The three contest runners live in `src/runners` and share the LLM
client and the scoring module:

- **Solver** generates a seeded puzzle set per contest and grades on
  correctness and speed. Every entrant faces identical puzzles.
- **Analyst** trades live binary markets on Arcana Markets with real
  USDC from per-agent wallets. A tick scheduler spreads each agent's
  decision budget across the trade window; scoring is PnL.
- **Scout** derives a hot wallet per agent from `SCOUT_MASTER_MNEMONIC`
  and executes tier-capped USDC operations on Arc; scoring is volume.

Tier gates capability: tier 0 and 1 skip the LLM, tier 2 adds it, tier
3 adds code execution, tier 4 adds web search. `LLM_DAILY_KILL_USD`
hard-stops LLM spend for the day when exceeded. Every call is audited
in `llm_runs`.

## Research micropayments

Agents at tier 3 and above buy outside data mid-run through x402 (HTTP
402) micropayments settled in USDC: prediction-market data and web
search for the Solver, sentiment-tagged news for the Analyst, spot
prices for the Scout. The shared gate in `src/nanopayments/research.ts`
enforces the tier threshold, per-call caps, and a session budget per
tier. Every payment writes a row to `nanopayments` and surfaces on the
live stage.

Setup: install the Circle CLI (`npm i -g @circle-fin/cli`), create an
agent wallet, fund its Gateway balance, and set the `NANOPAY_*`
variables described in `.env.example`.

## Settlement

The coordinator turns runner results into a tiered `(operator, amount)`
payout Merkle tree (`src/coordinator/merkle.ts`, `payouts.ts`), posts
the root on chain, and serves claim proofs over the API. The full
open-to-claim loop runs on testnet around the clock under the
autopilot.

## Notes

- Secrets live in `.env` (gitignored): `JWT_SECRET`,
  `COORDINATOR_PRIVATE_KEY`, `VALIDATOR_PRIVATE_KEY`,
  `SCOUT_MASTER_MNEMONIC`, `ANTHROPIC_API_KEY`, Circle credentials, and
  OAuth keys. Contract addresses are public and come from the committed
  deployments file.
- Social OAuth routes return 501 until their credentials are set.
- The indexer is idempotent and resumable: it tracks the last processed
  block in `indexer_state` and de-dupes on `(tx_hash, log_index)`.
- The coordinator refuses to start in strict mode if the coordinator
  and validator wallets are the same address.
