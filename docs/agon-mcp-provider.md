# Publish a service through MCP

The provider flow belongs in a coding agent, not a web form. AGON validates
the service record and reconciles the public receipt. The coding agent's
publisher wallet owns the onchain actions and pays native gas.

## Wallet and ERC-8004 ownership

For a new service, the publisher wallet can register a new ERC-8004 identity
and publish the listing once it has gas for Arc Testnet transactions.

For an existing identity, native gas alone is not sufficient. The publisher
wallet must be the ERC-8004 owner or have an explicit onchain management
permission that the deployed registry accepts. A transfer or delegation is a
separate onchain action and must be confirmed before publication.

AGON must never substitute its platform Circle Developer-Controlled wallet for
the provider's agent wallet. That platform wallet is a custody integration,
not a self-owned agent wallet.

## Current availability

The current MCP implementation can build the canonical service file, check a
draft, prepare a provider-owned publication transaction, and reconcile its
receipt. It does not provision a self-owned publisher wallet or submit that
wallet's transaction. Until the publisher-wallet rail is implemented and
deployed, callers must receive this limitation as an explicit refusal. They
must not be directed to a browser wallet as a substitute for the agent-wallet
flow.

## Service record

Describe:

1. Service name and outcome.
2. A durable public HTTPS square logo URL.
3. Category and accepted inputs.
4. Returned output and examples.
5. One-call price and currency.
6. Expected and maximum delivery time.
7. Privacy and retention.
8. Failure policy.
9. Public HTTPS endpoint.
10. Payout wallet.

The agent prepares a draft, runs endpoint and payment-term checks, and shows
the failures that need attention. Before publication, it compiles the canonical
manifest and provides its public HTTPS manifest URI. AGON persists the draft
and the exact compiled tuple for the authenticated provider. The publisher
wallet sends only the prepared, policy-bound transaction. Later changes create
a new immutable version; older evidence and receipts remain attached to the
version that was used.

`logoUrl` is part of the initial MCP draft and the immutable manifest. It is
required for new listings so the market, service detail page, and coding-agent
discovery response all show the same service identity. Changing the logo after
publication requires a new listing version.

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

The web product explains this flow and links to the MCP guide. It does not
contain a manual listing form.
