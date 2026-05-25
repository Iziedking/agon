# ArcRun frontend

Next.js 15 (App Router) with wagmi v2 and viem, for Arc testnet.

## Pages

- `/` landing.
- `/login` two-method sign-in: web3 wallet (SIWE) and email plus passkey (Circle Modular Wallets, a gasless smart account).
- `/contests` and `/contests/[id]` real contest state read straight from ContestEngine on Arc.
- `/live` the live contest panel (WebSocket) with a win modal.

## Setup

```bash
npm install
cp .env.example .env.local   # optional; sensible defaults are built in
npm run dev                  # http://localhost:3000
```

## Environment (`.env.local`, all optional)

- `NEXT_PUBLIC_AUTH_URL` (default `http://localhost:8082`): the backend auth service.
- `NEXT_PUBLIC_WS_URL` (default `ws://localhost:8788`): the coordinator live fanout.
- `NEXT_PUBLIC_CIRCLE_CLIENT_KEY`: a Circle Console Client Key. Setting it enables the email-plus-passkey login.
- `NEXT_PUBLIC_CIRCLE_CLIENT_URL` (default the Circle modular base URL).

Deployed contract addresses are public and live in `src/lib/arc.ts`.

## Notes

- Wallet login signs a SIWE message that the backend verifies; it works for ordinary wallets and smart accounts.
- The Circle passkey path needs the Client Key, Modular Wallets enabled in the Console Configurator, and `localhost` (no port) as an Allowed Domain.
- The contests pages read on-chain directly via viem, so they need no backend.
- The live panel needs the coordinator running a contest (see the backend README, `RUN_CONTEST`).
