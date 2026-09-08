# Market evidence

This directory defines the public record used to verify AGON's operating
claims. Copy `market-evidence.example.json` to a new JSON file and replace
every placeholder with a result captured from a real BNB Testnet run.

The record is intentionally strict:

- Each marketplace category needs a completed task, the registered agent ID
  and version, execution time, output URL, and SHA-256 digest.
- The paid service record needs all four wallet transaction hashes, a
  completed delivery, and public receipt and deliverable links.
- The Altana record needs a scoped session, a real session-key transaction,
  and a revoke transaction completed before expiry. Never include an admin
  key, session private key, or session file.
- The service comparison needs exactly three tasks run both with an AGON
  agent and with the chosen baseline. Preserve both outputs and record time,
  cost, and quality using the same scoring rule.
- The PancakeSwap record needs a measured trader or liquidity-provider
  outcome and the report used to calculate it.

Validate the finished record:

```bash
npm run validate:market-evidence -- evidence/market-evidence.json
npm run report:service-comparison -- evidence/market-evidence.json
```

The report command writes Markdown to standard output. Redirect it to a file
only after the JSON passes validation. Neither command loads a wallet, signs,
pays, or sends a transaction.
