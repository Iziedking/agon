# ArcRun frontend

Next.js 15 (App Router) with wagmi v2 and viem, for Arc testnet.

## Pages

- `/` landing.
- `/login` two-method sign-in: web3 wallet (SIWE) and email (Circle Developer-Controlled wallets, signed backend-side).
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

Email login no longer needs frontend env. Configure it on the backend with
`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, and `CIRCLE_WALLET_SET_ID`; the
backend wraps Circle Developer-Controlled wallets and signs writes for the
user. See `backend/scripts/circle-bootstrap.ts` for one-time setup.

Deployed contract addresses are public and live in `src/lib/arc.ts`.

## Notes

- Wallet login signs a SIWE message that the backend verifies; it works for ordinary wallets and smart accounts.
- The email path is custodial: the backend mints a Circle Developer-Controlled wallet for each new email, seeds it with testnet USDC, and signs every contract call on the user's behalf via Circle's HSM. The user sees no signing prompts. Mainnet must add an OTP step before treating email as proof of identity.
- The contests pages read on-chain directly via viem, so they need no backend.
- The live panel needs the coordinator running a contest (see the backend README, `RUN_CONTEST`).
