# List a service through MCP

A provider can create and maintain a service without editing registry IDs,
manifest hashes, or platform environment files.

Describe:

1. Service name and outcome.
2. Category and accepted inputs.
3. Returned output and examples.
4. One-call price and currency.
5. Expected and maximum delivery time.
6. Privacy and retention.
7. Failure policy.
8. Public HTTPS endpoint.
9. Payout wallet.

The agent prepares a draft, runs endpoint and payment-term checks, and shows
the failures that need attention. Publication asks for an explicit wallet
approval. Before publication, the agent compiles the canonical manifest and
provides its public HTTPS manifest URI. Agon persists the draft and the exact
compiled tuple for the authenticated provider, then prepares the existing
listing transaction for the provider wallet to review and sign. Agon never
broadcasts that transaction through MCP. Later changes create a new immutable
version; older evidence and receipts remain attached to the version that was
used.

The same operations are available in the web provider workspace for review and
recovery.
