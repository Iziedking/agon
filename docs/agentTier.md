# How an agent gets strong

Every agent in ArcRun draws strength from three places. Each one matters,
but they don't all matter the same amount. The short version: you pay for
tier, you grind for training, you collect traits.

```
strength = tier x training x traits
```

That is the whole formula for the score-multiplier side. Scout (volume)
goes further and turns traits into concrete on-chain abilities, covered at
the end. The next sections explain each multiplier in plain language, then
a worked example shows how they stack.

## 1. Tier (pay to upgrade)

Tier is the agent's brain. It scales the hardest of the three because it
is the one users buy with USDC. A tier 4 agent is the best agent on Arc,
full stop. That is the product position and the math reflects it.

| Tier | Multiplier | What tier unlocks |
|---|---|---|
| 0 | 1x | No LLM. Random guesses only. Free starter agent. |
| 1 | 2x | Still guesses, but with a small luck nudge. |
| 2 | 4x | Real LLM calls. Single shot reasoning. |
| 3 | 8x | LLM with a calculator (code execution) and paid research. |
| 4 | 16x | LLM with a calculator, paid research, and live web search. |

A tier 4 agent has sixteen times the raw budget of a tier 0. By default it
beats every lower tier from the numbers alone: bigger swaps, faster
natural pace, the full LLM loop, web search, and the only tiers that spend
on research. On mainnet the tier 4 brain swaps to a larger model
(controlled by `LLM_MODEL_TIER4`) so the top of the ladder genuinely is
the smartest agent the platform can offer. Money in, model up.

Research spend (x402 micropayments for outside data) is gated to **tiers 3
and 4 only**, and only fires when the task actually needs it. Tiers 0 to 2
reason from the prompt alone and never spend.

## 2. Training (play to fine-tune, permanently)

Training adds a boost on top of tier, and it is **permanent**: it does not
reset between contests. It is also no longer tier-capped. A well-trained
low tier is meant to threaten a higher untrained one, which is what makes
the grind worth it. Tier still wins the average case because the tier base
is steep, but training is a real, free edge.

Six stats, each with **five permanent levels**: POWER, PRECISION, SPEED,
ENDURANCE, LUCK, FOCUS. Each level adds a fixed amount.

| Level | Permanent bonus |
|---|---|
| 1 | +0.2 |
| 2 | +0.4 |
| 3 | +0.7 |
| 4 | +1.0 |
| 5 | +1.5 |

The training multiplier is `1 + sum(level_bonus x stat_weight)`, where the
weights depend on the contest type. Maxing the two stats a contest cares
about lands near 1.9x for that contest; maxing all six tops out near 2.5x.

| Contest | What it cares about |
|---|---|
| Solver | PRECISION, POWER, FOCUS (reasoning quality) |
| Analyst | PRECISION, FOCUS (calibration) |
| Scout | SPEED, ENDURANCE (throughput) |

Higher levels take real time (level 1 near instant, then 24h, 72h, 5 days,
7 days) and cost Cycles ((level + 1) x 50). Cycles can buy the wait back.
The main Cycle drop is the weekly syndicate war: the top four syndicates
split a pool by rank (400 / 250 / 150 / 75) to their members, so your
syndicate's standing funds your training.

## 3. Traits (collect and equip)

Traits are the wild card. Agents earn them three ways: the daily mystery
box, placing top three in a contest or challenge, and win streaks (five
wins in a row unlocks a rare, ten unlocks a legendary). You stack up to
three per entry. Some pairs clash and the equip screen won't let you.

Three rarities, and a trait only fires when the contest matches its
**domain** (generic traits fire everywhere):

| Rarity | Effect in its domain |
|---|---|
| Common | A tiny 1 to 2% nudge. |
| Rare | A small but real 10 to 15%. |
| Legendary | A big mover. |

The same trait does **more on a higher tier**, scaled by a per-tier factor
(`[0.4, 0.6, 0.8, 1.0, 1.3]` for tiers 0 to 4). That is what makes "tier 4
with the right three" the strongest loadout in the arena: a low tier gets
a fraction of a trait's effect, tier 4 gets it amplified.

Traits are not one flat number any more. By domain:

- **Solver and Scout** express traits as concrete abilities (reasoning
  budget and attempts; swap size, cap, and pace), not a score multiplier.
- **Analyst** uses a trait score multiplier plus extra trades.

The score-multiplier stack (where it applies) is capped at 1.40x, so
traits can never out-multiply tier on their own. They are sauce, not the
meal. There is no Epic rarity and no routing or stochastic scoring any
more; both were retired in v2.

## How they all stack: a worked example

Two agents enter the same Solver round.

**Agent A, tier 4, fully trained, no traits.**
- tier base: 16
- training multiplier: about 1.9 (PRECISION, POWER, FOCUS maxed)
- effective reasoning strength: roughly 30

**Agent B, tier 2, trained, Puzzle Savant equipped.**
- tier base: 4
- training multiplier: about 1.6
- Puzzle Savant: a large reasoning-budget boost plus an extra attempt,
  scaled by the tier-2 factor (0.8)
- effective reasoning strength: well below A, but with a real second shot

A wins the average case comfortably, which keeps the marketing claim
("tier 4 is the best agent on Arc") true. B's legendary buys it more
attempts and a bigger budget, so on a hard puzzle where A's single pass
slips, B's extra shot can land. That is the design: tier dominates by
default, and the right trait gives a smaller operator a real, earned
chance rather than a dice roll.

## Scout: three levers and a live race

Scout (volume) is the clearest case of traits as concrete abilities. A
Scout round is a time-boxed swap race where **every agent runs its own
loop at once**, each on its own hot wallet, so the field swaps in parallel
and a slow agent never starves a fast one. A semaphore bounds how many
swaps are in flight so a large field can't flood the RPC.

Three independent levers decide the outcome:

| Lever | Raised by | Effect |
|---|---|---|
| Size | tier base, Whale Spotter (1.5x to 3.5x by tier), Liquidity Hunter | USDC per swap |
| Cap | Volume Titan, count commons, Arc Sovereign | how many swaps allowed this round |
| Speed | tier natural pace, the SPEED stat, Velocity | how fast swaps fire |

The cap is a flat **85 swaps for every tier**, raised toward a **120**
ceiling by count traits, and clamped by the shared 1024-per-day budget.
Tier does not raise the cap: its edge is bigger swaps and faster pace, so a
bare tier 4 still out-volumes a bare tier 3. A tier 3 carrying the count
trait keeps swapping after a bare agent has hit 85, and a SPEED-trained or
Velocity agent reaches its cap sooner. Traits and training tilt the odds
for a lower tier without handing it the win.

The race window is dense by design: a base of about 120 seconds, extended
toward 180 when the field carries swap traits so those agents can actually
spend the advantage, and never past the resolve deadline. Whether the cap
fully binds depends on how fast Arc round-trips land; the window, cap,
pace floor, and concurrency are all env-tunable so the balance can be
dialed after watching a live race.

## Where to see this in the product

- Workshop, per agent, per contest type: a breakdown showing tier base,
  training multiplier, equipped traits, and effective strength. No hidden
  math.
- Enter Contest modal: an EQUIP TRAITS step with the user's pool, max
  three picks, clash warnings inline.
- Live stage: the economy tape streams every swap, payment, and trade with
  its on-chain link as the race runs.

## Designed limits at the profile level

A profile can claim up to **6 agents** in total. **Three** can be in live
contests and **three** in live challenges at the same time. The same
profile cannot enter more than one agent in a single contest or challenge,
so a user can't Sybil the same pool with their own roster.

## Cost note

Tier and training cost USDC and Cycles respectively. Trait stacking costs
nothing per equip; collecting traits is a function of playing and winning.
The platform earns from tier upgrades and listing fees, not from gating
loadout decisions. See the [README](../README.md) for the revenue model.
