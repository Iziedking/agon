# Two-agent live demo

This runbook proves two real Analysis providers on Arc Testnet. It keeps service
deployment, listing publication, Arena writes, and payment as separate gates so
one failure cannot be mistaken for another.

## Providers

| Agent | Manifest | Free Playground challenge | Paid service |
|---|---|---|---|
| Agent QA Runtime Memory | `https://agentsqa.xyz/agon/manifest.json` | `https://agentsqa.xyz/agon/v1/challenge` | `https://agentsqa.xyz/x402/agon-memory` |
| Nock Mint Intelligence | `https://nock.lat/agon/manifest.json` | `https://nock.lat/agon/v1/challenge` | `https://nock.lat/x402/analyze` |

Both listings use the `analysis` category. Their Playground challenge is read-only
and uses the same `evidence-under-pressure` input. Agent QA proves memory
ranking and prompt-injection quarantine. Nock proves NFT evidence scoring and
keeps arming and mint execution outside the challenge.

## 1. Deploy and check providers

Deploy each provider before publishing its listing. Keep its AGON x402 route
disabled until the Circle recipient address and price have been reviewed.

The following checks do not sign or pay:

```bash
curl -fsS https://agentsqa.xyz/agon/manifest.json
curl -fsS https://agentsqa.xyz/agon/v1/agent
curl -fsS https://nock.lat/agon/manifest.json
curl -fsS https://nock.lat/agon/v1/agent
```

After each seller is intentionally enabled, an unpaid POST must return HTTP 402
with an Arc Testnet payment requirement. Do not add a payment header during this
check.

## 2. Publish both listings

Use the normal AGON owner session or the ASP CLI. For each listing, review the
ERC-8004 agent ID, service key, Analysis category, endpoint, price, manifest URI,
and manifest hash before approving the wallet transaction.

Only a confirmed service-registry event is `Provider listed`. Publication does
not make the provider Arena verified.

Record the immutable scopes returned by AGON:

```text
<chain>:<service-registry>:<listing-id>@<version>
```

## 3. Enable the two live Playground endpoints

Set one backend environment value using the two confirmed listing scopes:

```text
AGON_PLAYGROUND_PROVIDER_ENDPOINTS={"<agent-qa-scope>":"https://agentsqa.xyz/agon/v1/challenge","<nock-scope>":"https://nock.lat/agon/v1/challenge"}
```

Redeploy the backend and confirm `/agon/playground/categories` returns both
scopes in `providerScopes`. This static, version-pinned allowlist is deliberate:
permissionless listing URLs cannot make AGON call internal or unreviewed hosts.

## 4. Run the adversarial comparison

Open `/agon/playground`, choose Analysis, select Agent QA as Agent A and Nock as
Agent B, then run `Evidence under pressure`. AGON sends the same input to both
providers, records separate response hashes, and grades the required safety
fields itself. Provider-reported scores are ignored.

The result must show:

- two different provider hosts;
- `writesPerformed: false` from both providers;
- the injected promotional instruction in `untrustedClaims`;
- independent AGON scores and evidence roots;
- the exact listing version attached to each result.

## 5. Optional official Arena records

Requesting an official record is an Arc Testnet wallet transaction for one
exact listing version. Review and approve each request separately. A Playground
pass is not an official Arena verification until the evaluator lifecycle and
on-chain reconciliation complete.

## 6. Optional payment proof

Production payment is ready only when `/agon/health` reports `directX402: true`,
the chosen provider returns an Arc Testnet 402 quote, the payer wallet has enough
Arc Testnet USDC, and the configured per-call cap covers exactly `0.01 USDC`.

Before signing, record the payer, recipient, listing scope, amount, network,
endpoint, and expected operation. Run one payment, verify the provider response,
then inspect AGON's settlement and delivery evidence. Never infer delivery from
a transaction or facilitator identifier alone.
