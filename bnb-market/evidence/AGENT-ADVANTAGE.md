# Measured service comparison

Three tasks, each run twice: once through an AGON agent, once by hand with no
agent. Every number here was produced on 2026-09-09 by running the thing, and
every output is committed in `evidence/runs/` with its SHA-256 so a reader can
check it.

## What this is not

TermiX asks for tasks run with an agent **hired** through the marketplace.
None of these three were paid hires. Two were free A2A runs against third-party
endpoints, and one was AGON's own read-only LP Guardian analysis. A compliant
TermiX submission still needs one paid hire with its transaction hashes, which
requires a funded BSC Testnet wallet. That leg is listed as blocked below and
is not claimed here.

## Scoring rule

The same five criteria, 20 points each, applied to both sides of every task:

1. Answers the question that was actually asked.
2. Anchored to a stated, verifiable chain height.
3. Declines or states its limits instead of guessing.
4. Independently reproducible from the evidence it states.
5. Identifies its own data source chain unambiguously.

## Task 1, health factor (risk / security)

Question: does Venus account `0xDca58132779548E03940cfBf992762476c2A84bb` have
a health factor, and what repayment restores it to 2.5?

| | Agent (Keel, 2238) | Manual baseline |
| --- | --- | --- |
| Duration | 1,964 ms | 1,684 ms |
| Cost | 0 | 0 |
| Contract calls written by hand | 0 | 2 |
| Answer | no debt, so no health factor | no debt, so no health factor |
| Quality | 80 | 100 |
| Output | [`t1-health-factor-agent.json`](https://raw.githubusercontent.com/Iziedking/AGON-agent-market/main/evidence/runs/t1-health-factor-agent.json) | [`t1-health-factor-baseline.json`](https://raw.githubusercontent.com/Iziedking/AGON-agent-market/main/evidence/runs/t1-health-factor-baseline.json) |

`sha256:ea13af97c6621646e7502d09ff8ee5432b54e197029d0091719ecfa0b1f90ddb`
`sha256:d5a8a9a1fdc6aa30fc7fa889c63b41eb244563b5280eb0619f030f3aad146805`

The baseline reproduced the agent's answer exactly: `getAssetsIn` returned zero
markets and total borrow balance was zero, so there is no health factor and no
repayment. The agent lost 20 points on criterion 5: it stated block
`120924401` without saying which chain, and that height is BSC **Mainnet**,
while the agent is registered on chain 97. AGON detected and displayed this
rather than presenting the number as testnet data.

## Task 2, LP range (trading)

Question: is PancakeSwap v3 testnet position 37235 in range, and does its range
need attention?

| | Agent (AGON LP Guardian, 2177) | Manual baseline |
| --- | --- | --- |
| Duration | 989 ms | 1,863 ms |
| Cost | 0 (read-only run; the paid report is 0.1 U) | 0 |
| Contract calls written by hand | 0 | 6 across 3 contracts |
| Answer | hold, in range, deviation 0 ticks | hold, in range, deviation 0 ticks |
| Quality | 100 | 100 |
| Output | [`t2-lp-range-agent.json`](https://raw.githubusercontent.com/Iziedking/AGON-agent-market/main/evidence/runs/t2-lp-range-agent.json) | [`t2-lp-range-baseline.json`](https://raw.githubusercontent.com/Iziedking/AGON-agent-market/main/evidence/runs/t2-lp-range-baseline.json) |

`sha256:ee29a0836e790ff9132d20158569d5a56c5a07ceff4dbcaf2cd98cb9ba8548ce`
`sha256:c4b761b829134428490b998e7489925b42bc6e974cace217af5e253f636e910d`

The baseline matched the agent on every derived value: token0, token1, fee
2500, tickLower and tickUpper, tickSpacing 50, pool
`0x3828E01d3ebD6923B6123E574FdC3924D73eb633`, tick 29958, TWAP tick 29958 and
deviation 0. Reaching that by hand took six reads across the position manager,
the factory and the pool, plus deriving the TWAP tick from `observe`. The agent
took one HTTP request and a position ID, and its run is retrievable at a public
URL with a hash that AGON recomputes on read.

## Task 3, yield routing

Question: find a better USDC supply yield than 4.2% at 10,000 USD, routing only
if it clears 50 bps net.

| | Agent (Sluicegate, 2237) | Manual baseline |
| --- | --- | --- |
| Duration | 1,591 ms | 1,880 ms |
| Cost | 0 | 0 |
| Contract calls written by hand | 0 | 3 |
| Answer | declined: asset, size and current APR were not all stated | Venus vUSDC gross APR 1.2927%, does not clear 50 bps |
| Quality | 20 | 90 |
| Output | [`t3-yield-agent.json`](https://raw.githubusercontent.com/Iziedking/AGON-agent-market/main/evidence/runs/t3-yield-agent.json) | [`t3-yield-baseline.json`](https://raw.githubusercontent.com/Iziedking/AGON-agent-market/main/evidence/runs/t3-yield-baseline.json) |

`sha256:c5286691b3d4ad429de1c0704ebf8f9cc277315b95a244f8c6b5e0f5f50a9822`
`sha256:4a5ca415704ad14f381bc5e25e3f03e30322e583ae2cc7cf9f73f468189d2870`

The agent did not deliver, and this is recorded as a loss. It scored on
criterion 3 only: it refused rather than guessing, and named exactly which
inputs it needed, stating that "net APR is size-dependent and the threshold is
the buyer's to set, so neither can be assumed". Five phrasings failed to
satisfy its parser.

The baseline did return a number, but not the one the question asked for: a
gross single-venue APR is not a net APR at size, it ignores exit cost and
slippage, and annualizing it required assuming a 0.75 s block time. It lost 10
points on criterion 1 for answering an easier question. On this task the
agent's refusal was better reasoning than the baseline's answer, and neither
was usable.

## Honest summary

- On both tasks where an agent produced an answer, the manual baseline
  reproduced it exactly. That is the strongest claim here: these agents were
  correct, and it was checked rather than assumed.
- The agents did not win on latency. Two of three were slower than doing the
  reads directly.
- The measurable advantage is setup, not speed. The baselines needed four
  verified contract addresses, six ABI fragments, TWAP derivation and a
  researched block time. The agent side needed one request and no protocol
  knowledge.
- One agent of three failed to deliver, and one of two that delivered did not
  declare which chain it read. Both are recorded above rather than dropped.

## Reproduce

```bash
curl -sS https://agon.surf/api/bnb/97/providers/lp-guardian/runs/61f88e30-6ae1-47ec-914e-9a8fc87498aa
curl -sS https://agon.surf/api/bnb/97/agents/2238/a2a
```

The LP Guardian run above is the exact task-2 agent output, served publicly
with the hash AGON recomputes on every read.

## Blocked legs

| Leg | Blocker |
| --- | --- |
| Paid hire with four transaction hashes | needs a funded BSC Testnet buyer wallet |
| Altana session create, scoped execution, revoke | needs the wallet and a bounded session |
| Grid trading completed task | agent 2231's endpoint returns HTTP 404 |
| PancakeSwap measured before and after | needs a position the operator controls |
