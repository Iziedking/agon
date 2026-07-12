# Circle integration

ArcRun is an agent arena on Arc. Agents compete, buy data from each other and
from outside services, and get paid, all in USDC. Circle's products are not
decoration on top of that: they are the money layer it runs on.

This document goes product by product. For each one: what we use it for, why,
where the code is, which environment variables configure it, and how we checked
it works.

Every claim below was confirmed by live testing on 2026-07-12 unless it says
otherwise.

---

## 1. USDC on Arc

**What we use it for.** Everything. USDC is the settlement asset and the gas
token. Prize pools, stakes, agent-to-agent purchases, x402 payments, platform
fees, and the gas for all of it are one asset. Chain 5042002. USDC at
`0x3600000000000000000000000000000000000000`.

**Why.** A prize pool denominated in the same token that pays for the
transaction that settles it removes an entire class of failure. No agent ever
holds a gas token it cannot earn.

**Where it is in the code.** Because USDC is both native gas (18 decimals) and
an ERC-20 (6 decimals), any wallet that spends its whole ERC-20 balance will
revert when it cannot pay for its own transfer. Two places hold that line:

- `backend/src/runners/missions/a2a.ts`, `GAS_RESERVE6`. Before an operative
  buys intel from a specialist, the affordability check is
  `balance >= price6 + GAS_RESERVE6`, so the buyer always keeps enough USDC back
  to pay the gas on the `transfer` it is about to send.
- `backend/src/runners/scout.ts`, `SCOUT_GAS_RESERVE_USDC`. The Scout runner
  sizes each swap or transfer against its balance minus a per-op reserve, times
  the number of ops it plans to run.

The chain itself is viem's built-in `arcTestnet` (`backend/src/chain/arc.ts`,
`frontend/src/lib/arc.ts`). No custom `defineChain`.

**Env.** `ARC_RPC_HTTP`, `ARC_RPC_WS`, `CHAIN_ID=5042002`. The USDC address is
not an env var: it comes from `contracts/deployments/arc-testnet.json`, which
the config module validates at boot.

**How we verified it.** Every contest that has ever settled paid out in USDC on
Arc. The reserve logic is what a shipped Scout race and a shipped mission both
depend on: without it, a fully-funded hot wallet swaps its balance to zero and
then cannot pay gas for the return leg.

---

## 2. Circle Wallets (Developer-Controlled)

**Package.** `@circle-fin/developer-controlled-wallets` (pinned 9.6.0).

**What we use it for.** The email login path. An operator signs up with an
email, the backend mints them a Circle wallet on Arc, and from then on the
backend signs every contract call on their behalf: create an agent, enter a
contest, join a challenge, claim a prize, train.

**Why.** An operator competes on chain without ever holding a seed phrase. The
alternative is telling a first-time user to install a browser extension, fund
it, and not lose twelve words. That filter kills the funnel, and the whole point
of the product is that anyone can put an agent in the arena.

**Where it is in the code.**

- `backend/src/chain/circleDev.ts` is the only file that touches the SDK:
  - `createUserWallet(userRef)` mints the wallet at signup.
  - `createWalletOnChain(refId, dcwBlockchain)` provisions a wallet on a source
    chain for cross-chain top-ups. `APPKIT_TO_DCW` maps App Kit chain names to
    Circle blockchain codes.
  - `executeContractCall(params)` submits a contract execution and returns
    Circle's transaction id.
  - `getTxState(id)` polls that id until the on-chain hash appears.
  - `walletUsdcBalance(walletId)` reads the deposit balance during a top-up.
  - `seedTestnetUsdc(address)` requests faucet USDC for a fresh wallet.
- `backend/src/auth/index.ts`, `POST /wallet/execute`. Looks up the operator's
  `circle_wallet_id`, checks the target contract against `WRITE_ALLOWLIST` (the
  ArcRun contracts and USDC, nothing else), enforces the six-agent cap at the
  signing layer, then calls `executeContractCall`.
- `frontend/src/hooks/useCircleExecute.ts`. Mirrors wagmi's
  `useWriteContract` surface so a call site does not care which kind of wallet
  the user has. It converts `(abi, functionName, args)` into Circle's
  `(abiFunctionSignature, abiParameters)` shape, then polls until the tx hash is
  known.

**Env.** `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID`, plus
`CIRCLE_BLOCKCHAIN` (`ARC-TESTNET`) and `CIRCLE_AUTO_SEED_USDC`. Bootstrap once
with `backend/scripts/circle-bootstrap.ts` (`npm run circle:bootstrap`), which
generates the entity secret, registers the ciphertext, writes a recovery file,
and creates the wallet set.

**How we verified it.** Live signups on the deployed app: an email address gets
a wallet, the wallet gets faucet USDC, and the operator's agent mint lands on
Arc as a real transaction signed by Circle. `circleDevConfigured()` gates the
whole path, so a server without the keys returns 503 on the write endpoints
instead of half-working.

---

## 3. Circle Gateway and Nanopayments

This is the part of the integration we are proudest of, so it gets the most
space.

**Packages.** `@circle-fin/x402-batching` (pinned 3.0.4), both the `/client` and
the `/server` entry points.

### ArcRun runs its own x402 seller, on Arc

Every third-party x402 seller we integrated settles somewhere other than Arc.
Exa and Gloria both sell on Base mainnet. That is fine for buying research, but
it meant Circle's batched settlement rail never touched the chain the product is
actually built on, even though Arc Testnet is one of the chains Nanopayments
supports best.

So the platform became a seller.

`backend/src/nanopayments/arcSeller.ts` is a real x402 resource server. It calls
`createGatewayMiddleware` from `@circle-fin/x402-batching/server` with
`networks: "eip155:5042002"` (Arc Testnet, and only Arc Testnet), the Circle
testnet Gateway facilitator at `https://gateway-api-testnet.circle.com`, and a
price of `$0.001` a call. It sells live Polymarket odds, fetched keylessly from
the Gamma API, which is the same ground truth the mission grader scores against.
It runs as a small standalone Node listener rather than a Hono route, because
Circle's middleware is a standard `(req, res, next)` handler and keeping it off
the main app means it cannot affect the API. The auth service starts it
(`startArcX402Seller()` in `backend/src/auth/index.ts`), and it no-ops unless
`X402_SELLER_ENABLED=1`.

### Agents pay it with the Gateway client

`backend/src/nanopayments/index.ts` is the buyer side.

- `payViaSdk(opts)` builds a `GatewayClient` on `NANOPAY_GATEWAY_CHAIN`, checks
  the seller's asking price against the caller's remaining budget with
  `client.supports()`, then runs `client.pay()`. The SDK does the whole 402
  round trip: request, read requirements, sign an EIP-3009 authorization
  offchain, retry. No gas is spent by the agent.
- `providerForEndpoint(endpoint)` is the routing brain. When
  `NANOPAY_PROVIDER=auto`, an unknown host gets probed once: we read its 402
  quote, and if `accepts[0].extra.name` is `GatewayWalletBatched` the seller is a
  Circle Nanopayment and goes to the Gateway client. Everything else goes to the
  exact client. The verdict is cached per host. This is what lets a single
  mission round pay our Gateway-batched Arc seller and two exact-scheme Base
  sellers in the same pass, each with the correct settlement path.
- `payX402(opts)` is the single entry point the runners call. It writes one row
  to the `nanopayments` table on every outcome, settled or not, which is what the
  live stage renders and what the mission grader's "credit requires a settled
  payment" rule reads.

The mission runner's MAKE path calls it at
`backend/src/runners/missions/runner.ts`, `make()`. The fragment kind `market`
is bound to our own seller in
`backend/src/runners/missions/templates.ts` (`SERVICE_CATALOG`), so when an
operative decides to buy market intel, the money goes over Circle's rail, on Arc,
from one party in our economy to another.

### Verified end to end

Run on 2026-07-12 with `backend/scripts/arc-nanopay-e2e.ts`:

1. The unpaid request returned a 402. The quote carried
   `extra.name = GatewayWalletBatched` on `eip155:5042002`, with
   `verifyingContract 0x0077777d7eba4688bdef3e311b846f25870a19b9`.
2. `GatewayClient` on `arcTestnet` paid it. The payment succeeded.
3. The Gateway balance debited exactly 0.001 USDC, from 10 USDC to 9.999 USDC.
4. The seller returned 8 live Polymarket rows.

**One honest caveat.** The `transaction` field the Gateway payment returns is a
settlement id, a UUID, not an Arc transaction hash. Gateway settles the batch
later. The payment is real and the balance really debits, but that id is not a
link you can paste into an explorer, and we do not render it as one.

**Env.** `NANOPAY_ENABLED=1`, `NANOPAY_PROVIDER=auto`,
`NANOPAY_GATEWAY_CHAIN=arcTestnet`, `NANOPAY_WALLET_PRIVATE_KEY`, and on the
seller side `X402_SELLER_ENABLED`, `X402_SELLER_ADDRESS`, `X402_SELLER_PORT`,
`X402_SELLER_PRICE`. The seller vars are read directly from `process.env` in
`arcSeller.ts` and are documented in `deploy/.env.example`.

The Gateway client is built on one chain, and a Gateway balance is spent on the
chain it lives on. We point it at Arc Testnet, where we sell. That is a
deliberate constraint, and `backend/src/nanopayments/index.ts` says so in the
`HOST_PROVIDER` comment: a Gateway-batched seller on another chain would need a
funded Gateway balance on that chain.

**Scripts to reproduce.**

```bash
cd backend
npx tsx -r dotenv/config scripts/gateway-probe.ts     # Gateway and wallet balances per chain
npx tsx -r dotenv/config scripts/gateway-supports.ts  # which seller is payable on which chain
npx tsx -r dotenv/config scripts/arc-nanopay-e2e.ts   # the full round trip against our own seller
npx tsx -r dotenv/config scripts/gateway-deposit.ts --yes --chain arcTestnet
```

**Why this matters.** Sub-cent, gasless, agent-to-agent payment is the only way
an agent economy can price information at what it is actually worth. If every
purchase carried its own gas, a $0.001 data call would be absurd. Batched
settlement is what makes the price of a fact independent of the cost of moving
money to pay for it. That is the thing an agent economy needs and did not have.

---

## 4. x402, standard exact scheme

To be clear: x402 is an open standard, not a Circle product. This section is
here because the routing in section 3 only makes sense next to it.

**Packages.** `@x402/core`, `@x402/evm`.

**What we use it for.** Buying research from outside sellers:

| Seller | Host | Price | Network |
|--------|------|-------|---------|
| Exa | `api.exa.ai` | about 0.007 USDC a call | Base mainnet (`eip155:8453`) |
| Gloria | `api.itsgloria.ai` | about 0.05 USDC a call | Base mainnet (`eip155:8453`) |

Both are paid with real mainnet USDC out of the agent wallet's plain balance. No
Gateway is involved, and no Gateway deposit is needed for them.

**Where it is in the code.** `backend/src/nanopayments/index.ts`:
`getExactClient()` registers the exact EVM scheme (which covers both the v1
network-name dialect and the v2 CAIP-2 dialect, so one client pays both),
`payExactRequest(url, init)` runs the 402 round trip and digs the settlement
hash out of the `X-PAYMENT-RESPONSE` header, and `payViaExact(opts)` wraps it
with the budget cap and the persistence row.

**Env.** The same `NANOPAY_*` block. `NANOPAY_PROVIDER=auto` picks this client
for any seller that does not quote `GatewayWalletBatched`.

---

## 5. CCTP v2, via Circle App Kit

**Package.** `@circle-fin/app-kit`, `kit.bridge()`.

**What we use it for.** Moving USDC into and out of Arc. Three live paths, one
SDK:

1. **Browser wallets.** `frontend/src/components/redesign/FundsPanel.tsx`
   imports `AppKit` dynamically, subscribes to `bridge.approve`, `bridge.burn`,
   `bridge.fetchAttestation` and `bridge.mint`, and lights up a step strip as
   each one lands.
2. **Circle-wallet users.** `backend/src/chain/circleBridge.ts`, `circleBridge()`,
   behind `POST /wallet/bridge` in `backend/src/auth/index.ts`. It pairs
   `AppKit` with `createCircleWalletsAdapter`, so an email user's custodial
   wallet signs the burn. It uses the Forwarding Service (`useForwarder: true`)
   so the user needs nothing on the destination chain. This lives outside
   `/wallet/execute` on purpose: a bridge is a multi-step state machine, and
   `/wallet/execute` is single-transaction.
3. **Scout agents.** `backend/src/chain/scoutBridge.ts`, `bridgeScoutLeg()`. A
   Scout op is occasionally a real Arc to Base bridge instead of a swap, which
   counts toward the same volume score. Scout hot wallets are plain EOAs derived
   from a mnemonic, so they sign through App Kit's viem private-key adapter
   rather than the Circle Wallets adapter. One-way only: the return leg would
   burn on Base, which needs ETH gas the hot wallet does not hold.

Inbound bridging into Arc is supported from seven testnets: Ethereum Sepolia,
Base Sepolia, Arbitrum Sepolia, Optimism Sepolia, Polygon Amoy, Avalanche Fuji,
and Unichain Sepolia. The table that maps App Kit chain names to viem chain ids,
USDC addresses, explorers and faucets is `frontend/src/lib/bridge.ts`
(`BRIDGE_CHAINS`).

**Env.** No Circle key is needed for the bridge itself. The backend path needs
the Developer-Controlled Wallets credentials from section 2. The Scout path is
tuned with `SCOUT_BRIDGE_FRACTION`, `SCOUT_BRIDGE_USDC`,
`SCOUT_BRIDGE_DEST_CHAIN`, and is off by default (`SCOUT_BRIDGE_FRACTION=0`).

**How we verified it.** All three paths have run live. The Scout path returns
the burn transaction hash, which is the on-chain proof the USDC left Arc, and it
surfaces as a BRIDGE row on the economy tape.

---

## 6. Circle Swap Kit

**Packages.** `@circle-fin/swap-kit` (1.2.3), `@circle-fin/adapter-viem-v2`
(1.11.2), `@circle-fin/provider-stablecoin-service-swap` (1.1.5).

**What we use it for.** Real same-chain DEX swaps on Arc. The Scout runner's job
is to produce genuine on-chain volume, and a self-transfer is not volume. With
Swap Kit, a Scout agent swaps USDC into EURC and back, and the arcscan tape
shows token-to-token swaps.

**Where it is in the code.** `backend/src/chain/appKitSwap.ts`:

- `swapEnabled()` gates the path on `SCOUT_REAL_SWAPS` and `CIRCLE_KIT_KEY`.
- `executeSwap({ privateKey, tokenIn, tokenOut, amountIn })` builds a viem
  adapter with `createViemAdapterFromPrivateKey`, pins every client it makes to
  our configured Arc RPC, and calls Swap Kit's `swap()` against
  `SwapChain.Arc_Testnet`. It returns the transaction hash and the actual output
  amount, which is what sizes the return leg.
- `estimateSwap(...)` is the read-only diagnostic. It asks whether a fillable
  route exists without sending anything, which is how we tell a tunable revert
  (slippage, permit) apart from an empty route.

Both are called from `backend/src/runners/scout.ts`.

**Verified working on Arc Testnet.** A probe run swapped 1.0 USDC into 0.908261
EURC, then swapped that EURC back into 1.219206 USDC. Both legs settled on
chain. These are real token-to-token swaps, not transfers.

```bash
cd backend
SCOUT_REAL_SWAPS=1 CIRCLE_KIT_KEY=KIT_KEY:<id>:<secret> \
  SWAP_PROBE_PRIVATE_KEY=0x... npx tsx -r dotenv/config scripts/swap-probe.ts
# or, with the env already loaded: npm run swap:probe
```

**Env.** `SCOUT_REAL_SWAPS=1`, `CIRCLE_KIT_KEY`, and optionally
`SCOUT_SWAP_TOKEN_IN` / `SCOUT_SWAP_TOKEN_OUT` (default USDC and EURC) and
`SCOUT_SWAP_SLIPPAGE_BPS` (default 500). The Arc pool is shallow enough that a
large swap moves the price, so slippage is env-tunable and should be paired with
a small per-swap size.

**The fallback, said plainly.** `SCOUT_SWAP_FALLBACK_TRANSFER` (on by default)
makes Scout self-transfer USDC when a swap route fails. It exists for one
reason: a failed route must not zero the field and cancel a live event with real
staked USDC in it. It is a safety net, not the normal path. The normal path is
the swap.

---

## 7. ERC-8004 on Arc

Not a Circle product, but it is Arc infrastructure and it is load-bearing, so it
belongs here.

**Identity.** Every ArcRun agent is an ERC-8004 identity NFT, minted through
Arc's IdentityRegistry at `0x8004A818BFB912233c491871b3d84c89A494BD9e`. See
`contracts/src/AgentRegistry.sol`: `createAgent(metadataURI)` calls
`_registerIdentity`, which calls `IdentityRegistry.register` and recovers the
minted token id (defensively, via the return value or via `onERC721Received`).
The registry contract holds the NFT, and the token id is stored on the agent's
row.

**Reputation.** After an event settles, the coordinator posts feedback to the
ReputationRegistry at `0x8004B663056A597Dffe9eCcC1965A193B7388713`. See
`backend/src/coordinator/reputation.ts`, `postValidatorFeedback()`, which calls
`giveFeedback(uint256 agentId, int128 score, uint8 rating, string tag, string
uri1, string uri2, string uri3, bytes32 feedbackHash)`. It signs from a separate
validator wallet (`VALIDATOR_PRIVATE_KEY`), which must not be the AgentRegistry
contract address, because ERC-8004 rejects self-feedback and the registry is the
on-chain owner of every agent NFT.

---

## What we did not integrate

Said explicitly so nobody has to guess:

- **StableFX.** Not integrated. It is a permissioned RFQ product that needs a
  Circle-issued API key, and we never called its API.
- **USYC.** Not integrated.
- **Circle Smart Contract Platform.** Not used. Our contracts are Foundry, built
  and deployed by us.
- **Circle Paymaster.** Not used. Gas on Arc is USDC, which is the point.
- **Circle Modular Wallets.** Removed. We started there and moved to
  Developer-Controlled Wallets; no Modular Wallets code remains.

---

## Package summary

Everything Circle we actually depend on, from `backend/package.json` and
`frontend/package.json`. Backend versions are pinned exactly, on purpose, so a
rebuild cannot silently pull a newer SDK that breaks the Arc swap route.

| Package | Version | Used for |
|---------|---------|----------|
| `@circle-fin/developer-controlled-wallets` | 9.6.0 | email login wallets, contract execution |
| `@circle-fin/x402-batching` | 3.0.4 | Gateway nanopayments, buyer and seller |
| `@circle-fin/app-kit` | 1.7.0 | CCTP v2 bridging, all three paths |
| `@circle-fin/adapter-circle-wallets` | 1.3.2 | bridging from a Circle custodial wallet |
| `@circle-fin/adapter-viem-v2` | 1.11.2 | bridging and swapping from an EOA |
| `@circle-fin/swap-kit` | 1.2.3 | USDC to EURC swaps on Arc |
| `@circle-fin/provider-stablecoin-service-swap` | 1.1.5 | the swap provider behind Swap Kit |
