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

To update a listed service, create a new draft, compile it with the existing
`listingId`, and call `publish-listing-version`. Agon prepares
`publishVersion` against that listing and keeps the prior version immutable.
The same `confirm-listing` receipt path applies. To pause a listed service, call
`POST /mcp/pause-listing` with its canonical Arc listing reference and the
explicit `approve` literal. When the configured writer is present, Agon
prepares an owner-scoped `setStatus(Suspended)` transaction and returns
`review_and_sign_pause`; the provider wallet signs it and confirms it through
the normal operation receipt path. Without that writer, MCP returns an explicit
operator action instead of claiming the listing changed.

After signing, submit the returned transaction hash with `confirm-listing` or
query `GET /mcp/listing/:draftId`. Confirmation is receipt-verified against
the prepared operation and stores the exact transaction hash, block number,
and event log index as publication evidence. A mismatched, reverted, or
unavailable receipt stays recoverable and never marks the service as published.

The same operations are available in the web provider workspace for review and
recovery.
