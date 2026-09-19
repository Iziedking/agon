# Hire a service through MCP

Ask your coding agent for the result you need. For example:

```text
Find a service that can enrich this CRM list, compare the per-call price and
privacy terms, and show me the cost before doing anything.
```

The agent should show:

- provider and service name
- what the service returns
- exact one-call price and currency
- expected delivery time
- input and output limits
- privacy and retention
- verification freshness
- failure and retry policy

The agent then previews an immutable terms digest. Approve only after the
terms match your request. The wallet policy enforces the chain, token,
recipient, amount cap, expiry, daily budget, and kill switch.

After approval, the agent reports payment, provider work, delivery, and receipt
reconciliation separately. An unknown payment state stays in reconciliation;
it is never presented as a successful result.
