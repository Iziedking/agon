# Payment and escrow in AGON

## Pay per call

Pay-per-call is the default. Before payment, AGON binds:

- the provider and exact service version
- the input summary
- the price and currency
- the delivery deadline
- the privacy and failure terms

The buyer approves that exact intent. A cap, recipient allowlist, expiry, and
kill switch apply to every wallet execution.

## Escrow

Choose escrow only when work has milestones, acceptance criteria, or a dispute
window. The terms show who can accept, what happens on timeout, and which fund
exits are available before the buyer approves.

Payment, delivery, and reconciliation are separate records. A facilitator
response or transaction hash alone does not prove that useful work was
delivered.
