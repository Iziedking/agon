# RECON Missions — spec

## Why

ArcRun's x402 nanopayments currently read as an enforced tax: research puzzles are
answerable without research, so a tier-2 agent that never pays can out-solve a
tier-3/4 agent that does. A judge sees wasted fees, not utility.

Missions fix this. A **mission** is a real task an agent can only complete by
**autonomously paying a micro-service via x402** to get data or compute it cannot
produce alone, with a **verifiable** deliverable, scored **competitively**. The
x402 payment stops being a tax and becomes the agent doing its job — the literal
"Best Agentic Economy on Arc" pattern, mirroring Coinbase's x402 Bazaar (agents
discover, pay for, and consume real APIs per call).

Open to **tier 3 and 4 agents only** (the tiers with research access). A new,
fourth event kind alongside `SCOUT | SOLVER | ANALYST | MISSION`.

See [[reference-x402-applicability]] for the research this is grounded in.

## The model in one diagram

```
generation:  template + live x402 service  ->  brief + captured ground truth
agent run:   reason -> pay x402 (real tx) -> fetch -> use -> submit answer
grading:     answer matches truth  AND  a settled payment exists for the service
ranking:     completed -> accuracy -> speed -> cost-efficiency (spent least wins ties)
```

## 1. Where missions come from

A **mission template library** bound to a live x402 service at generation time.
Each template defines a verifiable question shape; the live service fills the
specifics AND yields the ground-truth answer, captured at generation. Fresh every
run, open-ended (so a guess never matches).

Mission types (templates), simplest/safest first:

| Type | Service paid | Brief shape | Ground truth | Grading |
|---|---|---|---|---|
| **ORACLE** | Predexon / price feed | "current count/value of X right now" | the live value at gen | exact (count) / tolerance (price) |
| **INTEL** | Exa web search | "the fact about <recent event>" | the search result | source-anchored / exact |
| **SENTIMENT** | Gloria news | "which of A/B/C has the most bullish news" | ranked from headlines | graded pick |
| **RECON** (headline) | 2+ services | "of A/B/C, which has the most bullish news, and its current price" | synthesized from both | pick + value-in-tolerance |

A MISSION event runs K missions in the window (like the solver's rounds): mostly
single-service (ORACLE/INTEL), with 1-2 multi-service RECON as the swing.

Optional later: **sponsor bounties** — a project funds a pool and posts a
verifiable question (curated/admin-reviewed for the demo); rides the same grader.
Not in the first build.

## 2. How agent actions are verified

Three checks, two of which already exist on the current research-spend path:

1. **Answer vs captured ground truth.** Exact for counts, tolerance band for
   prices/rates, source-anchored for facts. To absorb drift, the grader re-checks
   the live source at grade time and accepts either the gen-time or grade-time
   value within tolerance.
2. **On-chain payment proof (already wired).** Every x402 call settles real USDC
   on Base and we already capture the settlement tx hash per call (`spentTx`,
   surfaced as `PAY` rows on the economy tape). Cryptographic proof of the action.
3. **Keystone rule — credit requires a settled payment.** A mission only counts
   if the answer is correct AND a verified x402 payment exists for that mission's
   service in this round. No pay -> no credit; pay + wrong -> no credit; right +
   paid -> verified completion. Combined with an unguessable answer, this is
   airtight: the payment proves the work, the match proves the result, the
   open-ended answer proves the data was used.

Plus the existing **solve-feed audit trail**, extended per mission: brief ->
service(s) paid (with tx links) -> data returned -> submitted answer. A judge can
read the whole chain: "paid Gloria 1¢ -> 3 headlines -> picked B -> correct, 4.2s".

## 3. Scoring

Absolute completion dominates; speed and cost only break ties (so spraying calls
never beats one precise buy, and one more completed mission always beats any
tiebreak):

```
score = (completed + 0.2*speedFactor + 0.1*efficiencyFactor) * SCORE_SCALE
  completed       = missions with credit (correct AND paid)
  speedFactor     = clamp(budgetMs / elapsedMs, 0, 1)        // faster = higher
  efficiencyFactor= clamp((budgetSpend - actualSpend) / budgetSpend, 0, 1)  // spent less of the allotted budget = higher
```

Ranking reads as: **completed -> accuracy -> speed -> cost-efficiency.** Same
"equal tasks for everybody, most-completed wins, ties to the most efficient"
fairness as the solver fix (pad to the full posted set; un-attempted = not
completed).

## 4. The agent run loop

Reason-first, so no wasted spend:

1. Read the brief.
2. Reason: does this need a live service, and which one?
3. Pay the x402 call (`paidAgentResearch` / the nanopayments module), capturing
   the settlement tx.
4. Use the returned data to produce the answer.
5. Submit. Grader applies section 2.

Tier 3/4 only have the research tool, so only they can complete missions; the
entry gate enforces min tier 3 on MISSION events.

## 5. Live stage + tape

- A new `MissionStage` (or reuse the solver stage shell): per-mission rows showing
  the brief, the agent's paid service(s) with tx links, and the verdict.
- Reframe the OUTPUT scoreboard for missions: `MISSIONS COMPLETED · PAID FOR
  SERVICES · ONCHAIN TX` — the spend reads as the edge, not a cost.
- The economy tape already renders `PAY` rows; mission completions reference them.

## 6. Data model

- `mission_templates` — static catalog (type, service, brief template, grader spec).
- Per-event generated missions carry `{ type, service, brief, expected, tolerance,
  presentation }` (mirrors `generated_puzzles`).
- Reuse the existing nanopayments spend tables for payment proof; no new payment
  schema.

## 7. Files (build surface)

Reuse the solver/puzzle machinery; do not rebuild streaming/scoring from scratch.

- `backend/src/runners/missions/` (new): `templates.ts` (library), `generator.ts`
  (bind template + live service -> brief + ground truth), `grader.ts` (the section-2
  checks), `index.ts` (round assembly).
- `backend/src/runners/mission.ts` (new): the runner — agent loop, reuses
  `nanopayments` for paid calls + `spentTx`, the LLM client for reasoning, the
  solver's streaming/emit shape.
- `backend/src/scoring/index.ts`: add `missionScore` per section 3.
- `backend/src/coordinator/`: register the MISSION event kind + autopilot path,
  default min tier 3.
- `backend/src/runners/types.ts` + `frontend/src/lib/live.ts`: a `mission` progress
  arm (brief, perMission verdicts, paid tx refs).
- `frontend/src/components/redesign/stages/MissionStage.tsx` (new) + `EventStage`
  dispatch + `OutputScoreboard` mission labels.
- `frontend/.../normalizeStageKind`: map MISSION.

## 8. Phasing

- **Phase 1 — prove the loop (ORACLE only):** one safe template (live count/value
  via Predexon/price), end to end: generate -> capture truth -> agent pays ->
  fetch -> answer -> grade (match + payment) -> score -> stage. The smallest thing
  that demonstrates verifiable paid utility.
- **Phase 2 — breadth:** add INTEL (Exa) and SENTIMENT (Gloria) single-service
  templates.
- **Phase 3 — headline:** RECON multi-service missions (2+ paid calls synthesized),
  the flagship demo.
- **Phase 4 (optional):** sponsor bounties on the same grader.

## 9. Verification (of this feature)

1. A tier-3 agent on an ORACLE mission pays a real x402 call (tx on Basescan),
   fetches the live value, answers within tolerance -> credit. Confirm the tape
   `PAY` row and the credit-requires-payment rule (force a no-pay correct answer ->
   no credit; force a paid wrong answer -> no credit).
2. A RECON mission shows 2 paid services in the audit trail leading to one answer.
3. Ranking: two agents both complete all missions -> the faster, then the
   lower-spend, wins.
4. Drift: a price ORACLE graded against gen-time and grade-time values within the
   tolerance band passes for a genuine fetch.
5. `npx tsc --noEmit` clean in backend and frontend.
6. **Verify before build:** confirm each endpoint (Predexon/Exa/Gloria/price)
   returns deterministically gradeable output via the circle / arc-docs MCP and
   the nanopay matrix, and that the x402 settlement tx is captured for each. Start
   on the lowest-drift template (ORACLE count).

## Risks

- **Drift** between generation and grade time — mitigated by count-type primary,
  tolerance bands for prices, short windows, dual-timestamp grading.
- **Endpoint determinism** — if a service is too noisy to grade, drop it to a
  non-scored "color" call or exclude it; lean on count/value oracles.
- **Don't force spend** — credit requires payment, but the answer must be one the
  service genuinely unlocks; never gate credit on a payment for data the agent
  already had. Reason-first keeps spend honest.
- No new smart contracts; all x402 / Gateway / existing event plumbing.
