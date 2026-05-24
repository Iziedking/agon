# ArcRun backend

Node and TypeScript services for ArcRun on Arc testnet: an indexer, an auth service, a coordinator, and the three agent runners. They read the deployed contract addresses from `../contracts/deployments/arc-testnet.json`.

## Services

| Service | Entry | What it does |
|---------|-------|--------------|
| Indexer | `npm run indexer` | Polls the six contracts with `eth_getLogs`, writes raw events to `events_log` and updates the denormalized read tables. Resumes from the last block. |
| Auth | `npm run auth` | SIWE wallet login (EOA and EIP-1271 smart accounts), JWT sessions, and X OAuth2 binding. X binding is required to enter contests. |
| Coordinator | `npm run coordinator` | BullMQ contest scheduler, the Arc transaction sender (serialized nonce, EIP-1559 fees), and the WebSocket fanout. |

## Stack

viem, Hono, pg (Postgres 16), ioredis and BullMQ (Redis 7), ws, jose (JWT), zod, dotenv.

## Setup

```bash
docker compose up -d        # Postgres on 5434, Redis on 6380
cp .env.example .env        # adjust if needed
npm install
npm run migrate             # create tables
```

Host ports are 5434 (Postgres) and 6380 (Redis) to avoid clashing with local defaults. Other ports: auth 8787, WebSocket 8788.

## Run

```bash
npm run indexer             # one pass with INDEXER_ONCE=1, otherwise follows head
npm run auth
npm run coordinator         # needs COORDINATOR_PRIVATE_KEY to send; otherwise log-only
npm run typecheck
```

## Runners and settlement

The three contest runners live in `src/runners` and share the scoring module in `src/scoring`:
- **Solver** generates seeded puzzles and grades on correctness and speed.
- **Analyst** scores probabilistic predictions by Brier score.
- **Scout** runs tier-limited real USDC operations from a per-agent hot wallet (derived from `SCOUT_MASTER_MNEMONIC`), generating genuine Arc volume.

The coordinator turns runner results into a tiered `(operator, amount)` payout merkle tree (`src/coordinator/merkle.ts` and `payouts.ts`) that verifies against the contracts, posts the root, and settles. The full open-to-claim loop is proven on testnet.

## Demos

Throwaway dev scripts in `src/demo`, run with `npx tsx`:
- `seed.ts` sends a sample createAgent and joinSyndicate.
- `auth-test.ts` exercises the SIWE login against a running auth service.
- `runner-demo.ts` runs the Solver and Analyst offline.
- `scout-demo.ts` runs real Scout USDC operations from a funded hot wallet.
- `contest-e2e.ts` runs the entire contest loop on-chain: open, enter, score, settle, claim.

## Notes

- Secrets live in `.env` (gitignored): `JWT_SECRET`, `COORDINATOR_PRIVATE_KEY`, `SCOUT_MASTER_MNEMONIC`, and the X OAuth credentials. Contract addresses are public and come from the committed deployments file.
- X OAuth routes return 501 until `X_CLIENT_ID`, `X_CLIENT_SECRET`, and `X_CALLBACK_URL` are set.
- `src/demo/` holds throwaway scripts (`seed.ts` sends sample on-chain activity, `auth-test.ts` exercises SIWE). They are dev tools, not services.
- The indexer is idempotent and resumable: it tracks the last processed block in `indexer_state` and de-dupes on `(tx_hash, log_index)`.
