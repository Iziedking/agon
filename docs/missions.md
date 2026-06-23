# Missions — a verifiable agent labor market on Arc

Spec for the missions build (started 2026-06-23). This supersedes the earlier
"RECON research-quiz" framing of this file; that framing is preserved at the
bottom under "Appendix: prior RECON spec" because its grading spine
(credit-requires-payment, the template library, drift handling) carries forward.

The qualifying delta for the Lepton/Canteen "Agents" hackathon (deadline Jun 29;
internal target Jun 27). Judged on Agency, Traction (real testnet payments),
Circle tool usage (x402/USDC), and Innovation. One RFB is agent-to-agent
networks, so the A2A payment layer is a primary scoring lever here, not a
nice-to-have.

---

## 1. The thesis

A mission is a real, open-ended commission an agent earns by doing work it cannot
do alone: gathering live data, buying intel from other agents, and synthesizing a
deliverable, with every hop settled on-chain in USDC. ArcRun is the venue and
takes a small rake on the flow.

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

## 1b. Missions span all three agent domains

A mission is not solver-only. Any agent family can be sent on a mission, and the
mission's `domain` decides what the operative actually does to complete it:

- **SOLVER missions (research/synthesis).** The flagship. The operative gathers
  fragments and synthesizes an intelligence deliverable. Needs the x402 + A2A
  wiring: MAKE = pay Exa/Gloria/Predexon; BUY = pay a specialist for intel.
- **ANALYST missions (prediction).** The operative forms and commits predictions
  (Arcana positions, market reads). Also needs the x402 + A2A wiring: MAKE = pay
  Gloria/Predexon for news/odds; BUY = pay a specialist for a read. Graded on
  prediction quality.
- **SCOUT missions (on-chain DeFi work).** The operative does real on-chain
  actions: swap, provide liquidity, borrow, lend, bridge. The MAKE path here is
  NOT x402 — it is the on-chain DeFi rails (the existing Scout swap/bridge seam).
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
wiring), then SCOUT missions (the DeFi-action execution path) once the rail is
proven. All three are in scope; the foundation is shared.

## 2. The three settlement layers (all on-chain USDC)

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

Every hop is a real on-chain settlement with a captured tx hash, so the whole
trail is judge-legible: pool funds the mission, operative pays a specialist,
specialist (or operative) pays a data service, winner claims the pool.

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

## 4. The economic model and its phased rollout

The same design seeds the demo today and opens to operators and projects later.
Everybody makes money at every phase.

### Phase A (v1, what we build now): platform seeds everything

- The **platform seeds the mission contest** (funds the prize pool) AND seeds a
  small set of **platform-run specialist agents that sell intel**. By our design,
  at the moment a mission is seeded its intel lives in the specialists' hands (the
  generator captures the ground-truth fragments and hands them to the specialists).
- Operatives compete: make (pay x402) or buy (pay a platform specialist), then
  synthesize and submit.
- Controllable, always-on supply side, so the demo loop never starves.

### Phase B (later, todo): operator-run intel sellers

- In a mission's join window, an operator can **choose their role: intel seller or
  mission contestant.**
- An operator who picks intel seller **buys intel from the platform specialists at
  a discount** and **resells it to contestants for a profit**. The platform still
  originates the intel; operators become a resale tier on top.
- This widens the A2A market from platform-to-operative to operative-to-operative,
  and gives non-winning operators a way to earn.

### Phase C (later, todo): project-seeded missions

- **Projects fund their own missions** (the adoption story: completing the mission
  is real usage of the project's product). By our design the mission's intel is
  placed in the platform agents' hands at seeding time, so the supply side is ready
  the moment the mission opens.
- Funding a mission is **team-designed**: the UI's "fund a mission" path tells the
  sponsor to contact the team so we design the brief, the verifiable ground truth,
  and the specialist intel for them. No self-serve mission creation in v1.

The default platform mission must be genuinely interesting on its own (section 6),
because it carries the demo until phases B and C land.

## 4b. Wallets, funding, and monetization

**Automatic spending (Phase A, decided 2026-06-23).** Every agent payment and
interaction in a mission happens with NO human signing, because the whole economy
is shown live. v1 uses the **hot wallets**: each operative and each specialist gets
a deterministic wallet derived from the master mnemonic by agentId
(`deriveHotWallet`, the proven Scout pattern), so the coordinator signs every A2A
payment and x402 call server-side, instantly, no wallet popup. Specialist wallets
live on a reserved agentId range (`MISSION_SPECIALIST_AGENT_ID_BASE`). A
Circle dev-controlled wallet per agent (stronger per-agent on-chain identity) is a
later upgrade, deliberately not built against the Jun 27 deadline and carrying
custody weight (see the production-readiness notes).

**Platform-funded floats.** For a frictionless run the platform fronts each
operative a USDC float (`MISSION_OPERATIVE_FLOAT_USDC`) before the mission and
sweeps the remainder after settlement, so participating costs the operator only
their entry, not their own working capital. Specialist gas is likewise funded.

**Monetization (Phase B/C, parked).** When the platform funds everything, the cost
is recovered with a **subscription to participate in missions**. To keep the
subscription fair and to reward genuine economic activity, an operative that
actually puts its float to work earns a **partial refund**: if it spent more than
~40% of its allotted budget on real intel/data/sub-work during the mission, a
portion of the subscription (or the float) is refunded. Agents that idle pay full
freight; agents that engage the economy get money back. Exact thresholds and which
base the 40% measures (the float vs the subscription) are an open knob recorded in
todo.md, not wired in v1.

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
| **INTEL** | Exa web search | a fact about a recent event | the captured fact + source | source-anchored / exact |
| **SIGNAL** | Gloria news | bullish/bearish read across headlines | the ranked read | graded pick |
| **MARKET** | Predexon | implied probability / live value | the captured value | tolerance band |

A mission runs K fragments in its window: mostly single-source, with a synthesis
ask that combines them. The operative decides per fragment whether to make (pay
the service) or buy (pay a specialist who already holds it).

## 8. Build surface (files)

Reuse the solver/coordinator/nanopayments machinery; do not rebuild
streaming/scoring/settlement.

- `backend/src/runners/missions/` (new):
  - `types.ts` — Commission, Brief, Fragment, MakeOrBuyDecision, MissionResult.
  - `templates.ts` — the INTEL/SIGNAL/MARKET template library.
  - `generator.ts` — bind templates to live services, capture ground truth, build
    the brief, seed specialist intel.
  - `specialists.ts` — platform-seeded specialist agents (own hot wallets on a
    reserved agentId range) that price and serve intel.
  - `a2a.ts` — the bounded handshake and the real on-chain USDC transfer between
    agent wallets; writes `a2a_trades`.
  - `runner.ts` — the MissionRunner: the section-3 loop, returns `AgentResult[]`.
  - `grader.ts` — section 5 (judge quality + credit-requires-payment).
- `backend/src/coordinator/`: dispatch MissionRunner when a contest has a `missions`
  row; `openMission()` in contestOps; an autopilot path behind `MISSION_ENABLED`.
- `backend/src/config/index.ts`: `MISSION_*` env vars.
- DB (new, idempotent): `missions`, `mission_specialists`, `a2a_trades`,
  `mission_fragments`. Reuse `nanopayments` for the make-path proof; reuse
  `entries`, `payouts`, `event_standings` for entry and settlement.
- Frontend: a mission arena page and the live agentic-economy tape
  (agent-paying-agent and agent-paying-service rows with tx links). ArcRun brand
  via the `arcrun-redesign` skill.

## 9. On-chain identity of a mission

A mission is a SOLVER-type contest on `ContestEngine` (cType 2) tagged by a row in
the `missions` table. No contract redeploy: entry, the prize pool, the score root,
settle, and claim are the existing solver-contest path. What differs is the
coordinator runs the MissionRunner (not the SolverRunner) and the run produces real
A2A and x402 settlements along the way.

## 10. Build steps (each a clean, working commit)

1. Spec + config + types + template library (this commit).
2. Platform-seeded specialists + the A2A rail (request/offer/accept/pay,
   on-chain USDC), verifiable in isolation.
3. The MissionRunner (the section-3 loop with autonomous make-or-buy).
4. The grader (judge quality + credit-requires-payment).
5. Coordinator wiring + a default mission on autopilot + settlement.
6. Frontend mission arena + the live economy tape + demo polish.

## 11. Verification

1. A2A: an operative buys a fragment from a specialist; assert a real USDC
   `Transfer` from the operative wallet to the specialist wallet with a captured
   tx, an `a2a_trades` row, and the specialist balance up by the price.
2. Make: an operative pays an x402 service; assert the settlement tx is captured
   (existing nanopayments path).
3. Credit-requires-payment: force a good deliverable with NO payment trail -> no
   credit; force a paid-but-weak deliverable -> judge rejects -> no credit; good +
   paid -> credit.
4. Settlement: the field scores, the merkle root posts, a winning operative claims
   real USDC.
5. `npx tsc --noEmit` clean in backend and frontend; contracts untouched.

## 12. Risks

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

---

## Appendix: prior RECON spec (superseded framing, kept for the grading spine)

The earlier version of this file framed missions as a research quiz: an agent pays
an x402 service to answer a verifiable question, credited only when a settled
payment exists. That framing is superseded by the labor-market model above, but
these pieces carry forward unchanged and are already shipped:

- **Credit-requires-payment** across all grading paths (the keystone, section 5).
- **The live-value ORACLE** and **RECON multi-asset synthesis** research slots in
  the solver (`runners/puzzles/oracle.ts`), which prove the verifiable-paid-utility
  loop end to end.
- **Drift handling:** count-type primary, tolerance bands for prices, short
  windows, dual-timestamp grading (gen-time and grade-time both accepted within
  tolerance).
- **Template-to-live-service binding** at generation time, captured ground truth.

The new model keeps all of this and adds the second settlement layer
(operative -> specialist) and the autonomous make-or-buy decision on top.
