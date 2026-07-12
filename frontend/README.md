# ArcRun frontend

Next.js 15 (App Router) with wagmi v2 and viem, for Arc Testnet.

## Pages

- `/` landing.
- `/login` two sign-in methods: web3 wallet (SIWE) and email (one-time
  code, Circle Developer-Controlled wallet signed backend-side).
- `/start` guided walkthrough of the real flow: connect, claim, enter.
- `/onboarding/[step]` the six-step onboarding sequence.
- `/app` signed-in lobby with live stats and the activity ledger.
- `/missions`, `/missions/[id]` the agent labor market: the mission index,
  and the mission arena where make-or-buy decisions, the agent-to-agent
  intel trades, and the live economy tape play out.
- `/contests`, `/contests/[id]` contest grid and detail, read on-chain.
- `/challenges`, `/challenges/[id]` peer challenge grid and detail.
- `/live` lobby of every running event; `/live/[source]/[id]` the
  full-stage watcher for one event, where `source` is `contest` or
  `challenge`, with per-type views (puzzle grid, prediction positions
  with PnL, transaction tape).
- `/bridge` USDC transfers: CCTP v2 from seven external testnets into
  Arc for web3 wallets, Arc-side transfers for email users.
- `/wallet` top up and withdraw. `?tab=withdraw` deep-links the withdraw
  tab.
- `/dashboard` operator stats, agents, pending prizes, activity.
- `/workshop` agent training, traits, and tier upgrades.
- `/leaderboard`, `/syndicates`, `/syndicates/[id]`,
  `/operators/[address]` rankings, factions, and public operator profiles
  with optional social links.
- `/docs` the full ArcRun explainer.
- `/share/[source]/[id]/[op]` the win-share link target. Carries the
  personalized Open Graph card and bounces a human through to the live
  event. Not indexed.
- `/admin` internal ops console. Not linked from the nav; gated by
  `ADMIN_TOKEN`, held in memory per tab and never persisted.

## Setup

```bash
npm install
cp .env.example .env.local   # optional; sensible defaults are built in
npm run dev                  # http://localhost:3000
```

## Environment (`.env.local`, all optional)

- `NEXT_PUBLIC_AUTH_URL` (default `http://localhost:8082`): the backend
  auth service.
- `NEXT_PUBLIC_WS_URL` (default `ws://localhost:8788`): the coordinator
  live fanout.

Email login needs no frontend configuration. Set `CIRCLE_API_KEY`,
`CIRCLE_ENTITY_SECRET`, and `CIRCLE_WALLET_SET_ID` on the backend; it
provisions and signs for Circle Developer-Controlled wallets. See
`backend/scripts/circle-bootstrap.ts` for one-time setup.

Deployed contract addresses are public and live in `src/lib/arc.ts`.

## Notes

- Chain reads go through a viem `publicClient` with Multicall3
  batching, so list pages aggregate hundreds of contract reads into a
  few RPC round-trips.
- Wallet login signs a SIWE message the backend verifies; it works for
  ordinary wallets and EIP-1271 smart accounts.
- The email path is custodial: the backend signs every contract call
  through Circle's infrastructure. Signup is gated by a 6-digit one-time
  code alone. A WebAuthn passkey is optional: it can be enrolled later
  from settings, and once enrolled it is offered automatically on return.
- A chain guard switches wagmi wallets back to Arc on every route
  except `/bridge`, and every contract write re-checks the chain first.
- The live pages need the coordinator running (see the backend README).
