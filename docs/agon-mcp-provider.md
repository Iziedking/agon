# Publish a service through MCP

The provider flow belongs in a coding agent, not a web form. AGON validates
the service record and reconciles the public receipt. The coding agent's
publisher wallet owns the onchain actions and pays native gas.

## Wallet and ERC-8004 ownership

For a new service, a funded publisher wallet can register a new ERC-8004
identity and then publish the listing. The current AGON MCP cannot perform the
registration. If no identity exists, this is a blocking step rather than a
reason to substitute AGON's platform wallet.

For an existing identity, native gas alone is not sufficient. The publisher
wallet must be the ERC-8004 owner or have an explicit onchain management
permission that the deployed registry accepts. A transfer or delegation is a
separate onchain action and must be confirmed before publication.

AGON must never substitute its platform Circle Developer-Controlled wallet for
the provider's agent wallet. That platform wallet is a custody integration,
not a self-owned agent wallet.

## Current availability

The current MCP implementation can build and host a version-specific canonical service file, check a
draft, prepare a provider-owned publication transaction, and reconcile its
receipt. It does not provision a self-owned publisher wallet or submit that
wallet's transaction. Until the publisher-wallet rail is implemented and
deployed, callers must receive this limitation as an explicit refusal. They
must not be directed to a browser wallet as a substitute for the agent-wallet
flow.

The intended single-session path is: provision or connect a self-owned agent
wallet, show the gas address, check ERC-8004 ownership, prepare registration
if missing, wait for its confirmed receipt and agent ID, then compile and
publish the AGON service. Registration and publication are separate onchain
actions. Neither may be described as complete from prepared calldata alone.

Connect a coding agent to `https://api.agon.surf/agon/mcp`. The native tool
sequence is:

```text
start_listing -> check_listing -> compile_listing
-> prepare_listing_publication -> sign with the provider wallet
-> confirm_listing -> get_listing_publication
```

For a new version, use `prepare_listing_version` after compilation. To pause a
service, use `pause_listing`, then `confirm_pause` after broadcasting the
transaction. Each preparation returns the exact chain, contract address,
calldata, and arguments for the publisher wallet to review and sign.
For AGON CLI tokens, draft and compilation tools need `listing:prepare`;
publication and pause preparation need `listing:write`; receipt confirmation
needs `listing:confirm`; status reads need `agon:read`. The token holder must
also pass the ownership checks for the selected agent and listing.

## Service record

Describe:

1. Service name and outcome.
2. A durable public HTTPS square logo URL.
3. Category and accepted inputs.
4. Returned output and examples.
5. One-call price and currency.
6. Expected response time.
7. Privacy and retention.
8. Failure policy.
9. Public HTTPS endpoint.

The agent prepares a draft, validates its fields and HTTPS URLs, and shows
the failures that need attention. A draft check does not test the live endpoint.
Before publication, `compile_listing` stores the canonical manifest at an
immutable AGON HTTPS URL when service-file hosting is configured. No separate
file upload is needed. The URL contains the agent ID, service key, version,
and content hash. A provider can still supply an existing public HTTPS
`manifestUri`; AGON checks its contents before preparing the transaction.
AGON persists the draft
and the exact compiled tuple for the authenticated provider. The publisher
wallet sends only the prepared, policy-bound transaction. Later changes create
a new immutable version; older evidence and receipts remain attached to the
version that was used.

`logoUrl` is part of the initial MCP draft and the immutable manifest. It is
required for new listings so the market, service detail page, and coding-agent
discovery response all show the same service identity. Changing the logo after
publication requires a new listing version.

To update a listed service, create a new draft, compile it with the existing
`listingId`, and call `prepare_listing_version`. Agon prepares
`publishVersion` against that listing and keeps the prior version immutable.
The same `confirm_listing` receipt path applies. To pause a listed service,
call `pause_listing` with its canonical Arc listing reference and the explicit
`approve` literal. When the configured writer is present, Agon prepares an
owner-scoped `setStatus(Suspended)` transaction and returns
`review_and_sign_pause`; the provider wallet signs it and submits the hash to
`confirm_pause` with the same listing reference and operation ID. Without that writer, MCP returns an explicit
operator action instead of claiming the listing changed.

After signing a publication or version update, submit the transaction hash
with `confirm_listing`. Use `get_listing_publication` with the draft ID to read
its status; it does not submit a transaction hash. Confirmation is receipt-verified against
the prepared operation and stores the exact transaction hash, block number,
and event log index as publication evidence. A mismatched, reverted, or
unavailable receipt stays recoverable and never marks the service as published.

The web product explains this flow and links to the MCP guide. It does not
contain a manual listing form.
