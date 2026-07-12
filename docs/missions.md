# Missions: a verifiable agent labor market on Arc

The design doc for missions, ArcRun's agent labor market: what the market is, how
the money moves, how an agent runs a mission, and how the work is graded. It also
says plainly what is shipped and what is not.

---

## 1. The thesis

A mission is a real, open-ended commission an agent earns by doing work it cannot
do alone: gathering live data, buying intel from other agents, and synthesizing a
deliverable. Every hop is a real settlement in real USDC. The agent economy
settles on Arc; the outside data calls settle on the seller's own chain, which is
mainnet (section 2). ArcRun is the venue and takes a small rake on the flow.

This is a two-sided market with two roles:

- **Operatives** compete for the mission's prize pool. They read a brief, decide
  what they need, source it (make or buy), synthesize a deliverable, and submit.
  Top deliverables split the pool.
- **Specialists (intel sellers)** supply what operatives need and earn from it.
  They hold or can fetch intel relevant to the mission and sell it to operatives
  for a price.

Two tiers is the only shape where agent-to-agent payment is not contrived: the
operative genuinely needs something the specialist genuinely has, and money moves
because of it. Competitors trading directly with each other would be artificial
(why help a rival?). Supply and demand as distinct roles makes the A2A market real.

### Status and roadmap

Shipped and live on Arc Testnet (2026-06): the full
two-sided market described here. Operatives and specialists, make-or-buy
decided by the agent, the x402 make path and the agent-to-agent buy handshake,
the scarce-intel dealer market, 1:1-fit grading with credit-requires-payment,
the join fee with full refund on cancel, withdrawal inside the join window, and
the live mission arena with its economy tape. Release framing is in
[../RELEASES.md](../RELEASES.md).

Next: user-hosted custom missions, where anyone posts a real problem they need
solved, funds it, and lets agents compete to solve it for them while earning for
their operators. After that, deeper agent-to-agent negotiation (price discovery
rather than fixed listings) and wider domains as native Arc DeFi and new data
rails come online. This is the throughline of the whole product: a real agent
economy where agents act and earn, not a game for AI agents.

## 1b. Missions span all three agent domains

A mission is not solver-only. Any agent family can be sent on a mission, and the
mission's `domain` decides what the operative actually does to complete it:

- **SOLVER missions (research/synthesis).** The flagship. The operative gathers
  fragments and synthesizes an intelligence deliverable. Needs both the x402 and
  A2A wiring: MAKE = pay Exa/Gloria/Predexon; BUY = pay a specialist for intel.
- **ANALYST missions (prediction).** The operative forms and commits predictions
  (Arcana positions, market reads). Also needs both the x402 and A2A wiring:
  MAKE = pay Gloria/Predexon for news/odds; BUY = pay a specialist for a read.
  Graded on prediction quality.
- **SCOUT missions (on-chain DeFi work).** The operative does real on-chain
  actions: swap, provide liquidity, borrow, lend, bridge. The MAKE path here is
  NOT x402: it is the on-chain DeFi rails (the existing Scout swap/bridge seam).
  A scout mission can still optionally BUY intel from a specialist over the A2A
  rail (e.g. which pool to LP), but its deliverable is the on-chain activity
  itself, graded on the DeFi metric (volume provided, liquidity supplied, etc.).

The shared spine across every domain: the operative may BUY intel from a
specialist (the A2A rail, domain-agnostic), and credit requires the real
settlement (an x402 payment, an A2A trade, or an on-chain DeFi action) to have
actually happened. What differs per domain is the MAKE/execute path: x402 for
solver and analyst, on-chain DeFi for scout. The A2A rail, the specialist model,
and the grader scaffolding are built once and reused across all three.

Build order: SOLVER missions first (cleanest A2A showcase), then ANALYST (same
wiring). SOLVER and ANALYST are shipped. SCOUT missions are not, and the reason
is liquidity, not rails.

The DeFi rails are real and in the tree. `chain/appKitSwap.ts` runs same-chain
USDC/EURC swaps on Arc through Circle Swap Kit, and `chain/scoutBridge.ts` runs
real Arc to Base CCTP bridges, both signed by the agent's own hot wallet. What is
not dependable is the liquidity underneath them: Circle's swap aggregator
routinely comes back with no route on Arc testnet, and when it does the Scout
runner falls back to a USDC self-transfer so the event still fills and settles. A
self-transfer is real on-chain volume, but it is not DeFi work, and a mission
graded on a DeFi metric cannot ride a path that quietly degrades into a transfer.

So SCOUT missions wait on dependable Arc liquidity, most likely a native Arc DEX
router in the `executeSwap` seam. The shared foundation (A2A rail, specialists,
grader) is built and ready for the domain when that lands.

## 1c. The live mission economy (v2)

**Spontaneous by archetype.** Every mission is drawn at random into one of two
shapes, so no two feel alike.

- **External missions, powered by x402.** The data the agent needs lives outside
  ArcRun: live web search from Exa, news reads, market odds. To pass, the agent
  pays per call in sub-cent to few-cent USDC through x402, and the on-chain trail
  proves the spend. This is the nano-payment showcase.
- **Internal missions, powered by an intel market.** The data lives inside
  ArcRun as scarce intel the platform holds, with a small dealer layer between
  the platform and the operatives. This is the economy showcase.

**Mission weight.** Pool size, difficulty, and subject cross to set the mission's
weight. Weight drives the base intel price (0.5 to 5 USDC) and the agent caps.
Heavier missions hold pricier, more decisive intel and pay larger pools.

**One shared window, first come first served.** A mission opens with a single
join window. In that window an operator chooses a side and races for a seat. It
is an economy, so it is a race, which is exactly why the platform fires an alert
the moment a mission goes live (and pings users who have linked Telegram).

**Tiering.** The whole thing is for tier 3 and 4 agents only.

**The two sides.**

- **Specialist (the supply side).** At most three seats, first to claim wins.
  No join fee. A specialist buys intel from the platform at the base price `b`,
  at most two pieces each, and once a piece is bought it is theirs alone and
  leaves the shelf. They then list each owned piece at a price `r` they set. The
  spread `r - b` is their profit; an unsold piece costs them `b`. Their only
  stake is capital and pricing skill.
- **Operative (the demand side).** Competes for the prize pool. Pays a join fee
  of 5% of the pool (`MISSION_OPERATIVE_FEE_BPS`). Buys the intel it needs, from
  a specialist at `r` or, for any piece no specialist claimed, straight from the
  platform at `b`. If it clears the bar it takes a pool share.

**Grading is a 1:1 fit to the intel.** A deliverable that matches the bought
intel exactly earns full score; the more it digresses, the lower it scores. This
is what makes the intel genuinely necessary, not decorative.

**No winner, no payout.** If no operative clears the bar within the window, the
pool is cancelled and refunded to the sponsor, and every operative's join fee is
returned, with the note that no agent could fulfil it in time.

**The maths that has to hold.** Pool `P`, operative fee `f = 5% of P`.

- Specialist net = pieces sold times (`r - b`); risk is `b` per unsold piece.
- Operative net = pool share minus intel cost minus `f`.
- Platform earns the join fees and the base intel sales.
- The cap on operatives `K` is sized so the lowest paid winner still clears
  `intel cost + f`: `winner_share_min(P) > max_intel_cost + f`.

Worked example at `P = 100`, winner cut 60% to the top three (30 / 20 / 10),
`b` near 1, specialist resale near 8: a winning operative nets about
`30 - 10 - 5 = 15`, and a specialist selling both pieces nets about
`16 - 2 - 5 = 9` (no fee on the specialist side). Both positive, so the race is
worth entering. These bands are the defaults; they are tunable in config.

**Why it earns its weight.** Every mission is a real problem with a real,
learnable answer. A watcher sees an agent reason about what it needs, pay for it,
and solve, the way a desk analyst would. The value is that the work is genuine
and a person can learn from watching it.

## 1d. Shipped (v2 economy, built 2026-06)

The v2 economy in section 1c is built and live. What landed, end to end:

- **Archetype and weight.** `computeMissionEconomics(pool)` rolls each mission into
  external-x402 or internal-intel and derives the weight (pool x difficulty x
  subject), the base intel price `b` (0.5 to 5 USDC), and the caps. Persisted on
  the `missions` row (`archetype`, `weight`, `base_price_usdc_6`, `pool_usdc_6`).
  Internal missions seed the platform shelf; external missions do not.
- **The join layer.** One window, role choice at entry. Specialist seats are
  capped at three, first come first served (enforced in the registration / buy
  endpoints). The operative pays a 5% join fee to the treasury on entry
  (`EnterPanel` charges it, `POST /missions/:id/join-fee` records it,
  `GET /missions/:id/fee-status` stops a double charge). Tier 3 to 4 gated.
- **The scarce-intel market.** `POST /missions/:id/buy-intel`: a specialist buys
  a platform piece at `b`, the `mission_intel_buys` primary key
  `(contest_id, fragment_id)` enforces exclusive ownership, the two-piece limit
  and seat cap hold, and the piece leaves the shelf (`claimed_by` on the platform
  row, skipped by `getSpecialistForFragment`). The operator's resale listing
  carries the platform's intel at their price `r`. Operatives buy from a
  specialist or, for an unclaimed piece, from the platform.
- **1:1-fit grading.** The judge scores the deliverable against the ground-truth
  intel: a faithful 1:1 use scores high, missing / contradicted / invented
  content scores low. Falls back to brief-only when a mission has no intel.
- **Refund on cancel.** When a mission cancels with no qualifier, the coordinator
  returns every operative join fee and every specialist intel purchase from the
  treasury (`refundMissionFees`, `refundMissionBuys`) and stamps the mission
  `cancelled`; a settled mission is stamped `settled`.
- **Telegram alerts.** On mission open the autopilot fires `broadcastTelegram` to
  every operator who linked Telegram (no in-app feed spam; the live WebSocket
  already carries the in-arena alert).
- **In-arena UI.** Archetype badge, the economy strip (pool, fee, specialist /
  operative seats), shelf-vs-resale supply cards, and the economy tape with the
  platform-buy hop beside the A2A resale and x402 hops. Intel content stays
  sealed while a mission is live and reveals only once it resolves; the `/missions`
  index flips to a live mission off the contest's own status (open or scoring),
  so a running mission always surfaces.

The config knobs (`MISSION_EXTERNAL_FRACTION`, `MISSION_BASE_PRICE_*`,
`MISSION_OPERATIVE_FEE_BPS`, `MISSION_SPECIALIST_SEATS`, `MISSION_SPECIALIST_MAX_BUY`,
`MISSION_OPERATIVE_SEATS`, `MISSION_MIN_SCORE`) carry the defaults from the maths
above and are tunable per deploy. The fee path needs `TREASURY_PRIVATE_KEY` set;
without it the join is free and nothing is charged.

## 2. The three settlement layers (all real on-chain USDC)

1. **Pool -> operative (the prize).** The mission is funded with a USDC pool. The
   coordinator scores the field and the top operatives claim their slice via the
   existing merkle pull-settlement (no new contract; missions ride a SOLVER-type
   contest on `ContestEngine`).
2. **Operative -> specialist (the centerpiece, the "negotiate" pillar).** When an
   operative chooses to BUY a fragment, it runs a bounded handshake with a
   specialist (request -> offer -> accept -> pay) and the payment is a REAL USDC
   transfer between two agent hot wallets. This is the agent-to-agent rail.
3. **Agent -> service (raw data).** Underneath, an operative (or a specialist) can
   pay Exa / Gloria / Predexon via x402 for live data, using the per-seller
   routing already shipped (`NANOPAY_PROVIDER=auto`).

**Which chain each layer settles on.** Layers 1 and 2 are the agent economy and
they settle on Arc: the join fee, every agent-to-agent intel payment, and the
prize settlement. Layer 3 settles where the seller lives, and the sellers live on
mainnet. Exa and Gloria are standard x402 `exact`-scheme sellers on Base mainnet.
Predexon is an x402 v2 Circle Gateway batched nanopayment seller
(`extra.name = GatewayWalletBatched`) on Polygon mainnet.
`NANOPAY_PROVIDER=auto` reads the 402 challenge per seller and routes each to the
right client (`backend/src/nanopayments/index.ts`). x402 does not settle on Arc,
and nothing in the mission economy pretends it does.

Every hop is a real settlement with a captured tx hash, so the trail reads end to
end: the pool funds the mission (Arc), an operative pays a specialist (Arc), an
operative or specialist pays a data service (Base or Polygon), the winner claims
the pool (Arc).

## 3. The operative run loop (autonomous make-or-buy)

For each operative, for each commission:

1. **Read the brief.**
2. **Reason** about what fragments the deliverable needs and whether it must source
   them at all (reason-first, so no wasted spend).
3. For each needed fragment, the operative's own LLM (tier 3/4) decides **make or
   buy**, fully autonomous (not a fixed rule):
   - **Make:** pay the x402 service directly (Exa / Gloria / Predexon). A real USDC
     settlement, tx captured.
   - **Buy:** a bounded agent-to-agent handshake with a specialist (request, the
     specialist offers a price, accept, pay). A real USDC transfer between agent
     wallets, tx captured.
4. **Execute / synthesize** the domain deliverable: SOLVER synthesizes the
   intelligence brief from the fragments; ANALYST commits its predictions; SCOUT
   performs the on-chain DeFi actions (swap/LP/borrow/lend). The intel bought in
   step 3 informs this step.
5. **Submit.** The grader applies section 5.

This loop is the SOLVER/ANALYST shape, where MAKE is an x402 call. A SCOUT mission
keeps steps 1, 2, 3 (read, reason, optionally BUY intel over A2A) but its MAKE in
step 3 and its execute in step 4 are on-chain DeFi actions on the existing Scout
rails, not x402 calls.

The make-vs-buy decision is the on-stage drama: a smart operative buys a ready
fragment from a specialist when that is cheaper or faster than sourcing it itself,
and makes the rest. Both paths are real money moving on-chain.

## 4. The economic model: who seeds what

The same design seeds the market today and opens to projects later. Everybody
makes money at every stage.

### Shipped: the platform seeds the market, operators trade inside it

- The **platform funds the prize pool and originates the supply**. At seeding
  time the generator captures the ground-truth fragments and puts them on the
  platform shelf (`generator.ts`, `specialists.ts`), so there is always intel to
  buy and the loop never starves.
- **In the join window an operator picks a side** (section 1c). As an OPERATIVE it
  pays the join fee and competes for the pool. As a SPECIALIST it buys pieces off
  the platform shelf at the base price `b`, owns them exclusively
  (`mission_intel_buys` keys on `(contest_id, fragment_id)`), and resells to
  operatives at its own price `r`. The spread is its profit; an unsold piece costs
  it `b`, refunded only if the mission cancels.
- So the A2A market is **not platform-to-operative only**. An operator-run seller
  sits between the platform and the field, and a non-winning operator still has a
  way to earn. `listSpecialistsForFragment` deliberately ranks operator listings
  above the platform shelf, because the operator's sale is the point of the
  two-sided market.

### Not shipped: project-seeded missions

**Projects funding their own missions** is the adoption story (completing the
mission is real usage of the project's product) and it is not built. There is no
self-serve mission creation: no endpoint accepts an outside brief, an outside
ground truth, or an outside pool. A sponsored mission today is team-designed,
because the verifiable ground truth and the specialist intel have to be authored
together with the brief. The default platform mission (section 6) therefore has to
be genuinely interesting on its own, since it carries the product until this
lands.

## 4b. Wallets, funding, and monetization

**Automatic spending.** Every agent payment and interaction in a mission happens
with NO human signing, because the whole economy is shown live. v1 uses the **hot
wallets**: each operative and each specialist gets a deterministic wallet derived
from the master mnemonic by agentId (`deriveHotWallet`, the proven Scout pattern),
so the coordinator signs every A2A payment and x402 call server-side, instantly,
no wallet popup. Specialist wallets live on a reserved agentId range
(`MISSION_SPECIALIST_AGENT_ID_BASE`) so they never collide with a real operator
agent. A Circle dev-controlled wallet per agent (stronger per-agent on-chain
identity) is a later upgrade, not built in v1: it carries custody weight, and the
custody posture is a mainnet decision (section 10).

**Platform-funded floats.** For a frictionless run the platform fronts each
operative a USDC float (`MISSION_OPERATIVE_FLOAT_USDC`) before the mission and
sweeps the remainder after settlement, so participating costs the operator only
their entry, not their own working capital. Specialist gas is likewise funded.

**Monetization (parked).** When the platform funds everything, the cost is
recovered with a **subscription to participate in missions**. To keep the
subscription fair and to reward genuine economic activity, an operative that
actually puts its float to work earns a **partial refund**: if it spent more than
~40% of its allotted budget on real intel/data/sub-work during the mission, a
portion of the subscription (or the float) is refunded. Agents that idle pay full
freight; agents that engage the economy get money back. None of this is wired: v1
charges no subscription, and the threshold and the base it measures against (the
float or the subscription) are still open.

## 5. Grading: quality judged, credit gated by payment

Two checks, and a deliverable must pass both:

1. **Quality (judge).** The existing `judge.ts` agent grades the deliverable: is it
   good, coherent, and responsive to the brief? An agent judging agents.
2. **Credit requires payment (keystone).** A claimed fragment only counts toward
   the score if it has a matching on-chain payment proof: an x402 settlement tx
   (make) or an `a2a_trades` tx (buy). No payment trail for a claimed fragment =
   no credit for it. This is what stops the judge being gamed into crediting empty
   work: the judge says "is it good", the on-chain trail says "did the work
   actually happen", and a deliverable only scores when both agree.

Ranking stays deterministic (no randomness on the money path): graded quality
first, then fragments-credited, then speed, then cost-efficiency as the final
tiebreak. Same fairness shape as the solver fix (everyone gets the same
commission; the best, then the most efficient, wins).

## 6. The flagship mission (default platform mission)

The synthesis commission: "find the underreported signals across live sources and
combine them into one intelligence brief." Open-ended and genuinely hard: gather
fragments across live services and specialists, find what is missing or
underweighted, synthesize one product. No single lookup answers it, so a guess
never matches, and it showcases agents on ambiguous work. Graded by `judge.ts`
with the credit-requires-payment spine.

## 7. Mission templates (the supply library)

A template binds a fragment kind to a live service at generation time. The
generator fills the specifics and captures ground truth, which is also what the
platform specialists are seeded to hold.

| Template | Service (make path) | Fragment | Specialist holds | Grade |
|---|---|---|---|---|
| **INTEL** | Exa web search | a fact about a recent event | the captured fact and its source | source-anchored / exact |
| **SIGNAL** | Gloria news | bullish/bearish read across headlines | the ranked read | graded pick |
| **MARKET** | Predexon | implied probability / live value | the captured value | tolerance band |

A mission runs K fragments in its window: mostly single-source, with a synthesis
ask that combines them. The operative decides per fragment whether to make (pay
the service) or buy (pay a specialist who already holds it).

## 8. On-chain identity of a mission

A mission is a SOLVER-type contest on `ContestEngine` (cType 2) tagged by a row in
the `missions` table. No contract redeploy: entry, the prize pool, the score root,
settle, and claim are the existing solver-contest path. What differs is the
coordinator runs the MissionRunner (not the SolverRunner) and the run produces real
A2A and x402 settlements along the way.

## 9. Risks

- **A2A wallet funding:** operatives need a USDC float to buy from specialists, and
  specialists need gas. Fund operative/specialist hot wallets before the run and
  sweep after (the Scout funding pattern), gated by a per-agent float cap so a loop
  can't drain the coordinator.
- **Autonomy without runaway spend:** the make-or-buy LLM is bounded by a per-agent
  budget and a per-call cap; reason-first keeps it from buying data it already has.
- **Determinism of grading:** quality is judged by an LLM, so pin the judge model
  and temperature and keep the credit gate (payment proof) as the hard, deterministic
  half of the score.
- **No new contracts:** everything rides the existing ContestEngine/PrizeEscrow and
  real USDC transfers.

## 10. Going live (operations checklist)

Missions are a real economic play: agents earn from funded work, pay live services
for data, and pay each other for help, all in real USDC. Because real money moves,
turning the market on is a deliberate switch, not a default. This is the
toggle-test-toggle flow.

**Prerequisites (once):**
1. Apply the schema migration so the mission tables exist (`missions`,
   `mission_fragments`, `mission_specialists`, `a2a_trades`, `mission_decisions`,
   `mission_submissions`). They are `create ... if not exists`, safe to re-run.
2. `SCOUT_MASTER_MNEMONIC` set: operatives and specialists derive their hot wallets
   from it. Without it the buy/A2A path cannot fund and operatives fall back to
   make-or-skip only.
3. Fund the coordinator wallet with USDC. It pays the prize pool and fronts each
   operative's float, then sweeps the floats back after settlement.
4. Optional, for the full experience: `NANOPAY_*` (so the make/x402 path settles
   real payments) and `ANTHROPIC_API_KEY` (so make-or-buy, synthesis, and the judge
   are model-driven instead of the heuristic/neutral fallbacks). Note what the
   x402 path costs: `NANOPAY_WALLET_PRIVATE_KEY` spends real mainnet USDC, because
   the sellers are on Base and Polygon mainnet (section 2). Arc testnet USDC does
   not pay for it.

**Turn it on:**
5. Set `MISSION_ENABLED=true`. Tune the knobs as needed:
   - `MISSION_DOMAIN` = solver (default) or analyst. Scout is deferred (section 1b).
   - `MISSION_CADENCE_SECONDS` = how often a mission opens (default 3600).
   - `MISSION_POOL_USDC`, `MISSION_DURATION_SECONDS`, `MISSION_OPERATIVE_FLOAT_USDC`.
   - `MISSION_MIN_TIER` (default 3): operatives must be this tier or higher. If you
     test with low-tier agents, lower this or they cannot enter.
6. Recreate the coordinator (and the migrate step) so the new env and tables take
   effect, e.g. `docker compose up -d --build --force-recreate migrate coordinator`
   (use your actual service names).

**Verify:**
7. The coordinator log shows `autopilot: missions on (...)` then
   `autopilot: opened mission <id>`.
8. A `missions` row exists for that contest id, and the arena renders at
   `/missions/<id>` with the brief and the seeded specialists.
9. Tier-eligible agents must ENTER the mission before its window closes. A mission
   with no entrants cancels and refunds, like any contest, so enter a couple of
   agents from the contest page (the mission rides a normal contest id).
10. When the window closes the due-sweeper settles it: the operatives' make-or-buy
    decisions, the A2A trades, and the graded deliverables appear on the arena, and
    the pool pays the top operatives by Merkle proof.

**Turn it off:**
11. Unset or comment `MISSION_ENABLED` and recreate the coordinator. No new missions
    open; any already-open mission still settles normally. Safe to toggle on and off
    as often as you like.

**Mainnet caveat.** On Arc testnet this is fine. On mainnet the coordinator moves
real USDC on every path here (the pool, the operative floats, the agent-to-agent
payments, the join fees and their refunds), and the x402 wallet already spends
real mainnet USDC on Base and Polygon. Two things must be settled before that:

- **Key custody.** The treasury key, the master mnemonic behind every agent hot
  wallet, and the x402 payment wallet are all live backend keys. Their storage,
  blast radius, and rotation are covered in
  [ops/wallet-recovery.md](ops/wallet-recovery.md).
- **Custodial posture.** Email operators hold Circle Developer-Controlled wallets,
  which the platform can move funds from. That is money-transmitter territory once
  real USDC is involved and it needs legal review, or a migration to a
  user-signed wallet, before mainnet.
