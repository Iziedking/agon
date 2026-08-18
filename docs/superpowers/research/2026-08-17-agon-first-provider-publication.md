# Agon first-provider publication research

Status: primary-source, repository, live-system, and naming-boundary research captured on 2026-08-17. This is a precondition for the first ERC-8004 registration and Agon listing. It is not transaction or production-deployment approval.

This document supersedes the earlier ArcRun/arcrun.xyz provider-publication draft. The canonical marketplace identity is Agon at `agon.surf`; no onchain URI using `arcrun.xyz` may be broadcast for this provider.

## Primary sources

- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [Arc: Register your first AI agent](https://docs.arc.network/arc/tutorials/register-your-first-ai-agent)
- [Circle: Become a seller](https://developers.circle.com/agent-stack/agent-marketplace/become-a-seller)
- [Circle: Get listed](https://developers.circle.com/agent-stack/agent-marketplace/get-listed)
- [Circle: Discovery API](https://developers.circle.com/agent-stack/agent-marketplace/discovery-api)

## Verified repository and live state

- Agon's seller is a real GET service at `/x402/market-intel`. It uses `@circle-fin/x402-batching` 3.0.4, Circle Gateway testnet, Arc Testnet CAIP-2 `eip155:5042002`, and defaults to `0.001 USDC` per request.
- The paid result is live Polymarket market data, not a fixture. The response contains up to eight open markets ordered by 24-hour volume, with implied yes price and end date.
- The seller listens on the auth container's port 8090. Canonical ingress is `https://api.agon.surf/x402/*`; legacy `api.arcrun.xyz` routing remains in Caddy during the transition.
- At the naming audit, `agon.surf` resolved to a registrar parking address and `api.agon.surf` had no DNS record. DNS and TLS therefore remain production gates, not assumptions.
- The funded owner wallet `0x0aeEF0Dd6b0754262d1a91e435565749Cdc365Ad` owned zero tokens in the official Arc Testnet ERC-8004 IdentityRegistry at the previous preflight. The first truthful publication requires registration before profile binding and listing publication.

## Specification requirements that affect the build

- ERC-8004's `agentURI` must resolve to a registration file containing the registration-v1 type, name, description, image, services, active state, and registrations. HTTPS is allowed. Serving the primary registration file on a controlled HTTPS domain proves control of that domain.
- Circle only lists a service after it returns `402 Payment Required` when unpaid, has a published OpenAPI specification, and supplies its payout wallet and service description for manual review. Agon publication does not imply Circle review or approval.
- Circle Discovery API results identify protocol version, accepted payment requirements, provider metadata, HTTP method and path, input/output schemas, and whether Circle Gateway or vanilla x402 is supported.
- Circle's example `0.01` is a documentation example. Agon's executable market-intel price is `0.001 USDC`; the marketplace form's `0.01` placeholder remains only a neutral x402 example.

## Implementation decision

1. Publish Agon marketplace identity and provider metadata on `agon.surf`; do not globally rename the legacy ArcRun arena.
2. Expose `/x402/*` on `api.agon.surf` to `auth:8090`, keep ordinary API traffic on `auth:8082`, and preserve legacy ArcRun host blocks during migration.
3. Publish three durable JSON resources on `agon.surf`:
   - a dynamic ERC-8004 registration file at `/.well-known/agon/agents/:agentId`;
   - an immutable Agon `market-intel` manifest v1;
   - an OpenAPI 3.1 document for the paid GET endpoint.
4. Keep one shared typed source for those documents and test the exact endpoint, price, registry coordinates, category, and canonical manifest hash.
5. Deploy a separate Vercel project named `agon`, configured with Agon product metadata and a root redirect to `/market`.
6. Do not register, bind, publish, deploy backend production code, or submit Circle's intake form until the relevant verification is green and the user separately approves the external action.

## Transaction sequence after production readiness

1. Register the final `https://agon.surf/.well-known/agon/agents/:agentId` URI in ERC-8004 and verify the successful receipt plus `Registered` event.
2. Bind the minted agent ID to the same registration URI in AgonProfileRegistry.
3. Publish the immutable `https://agon.surf/.well-known/agon/market-intel/manifest-v1.json` URI and canonical hash in AgonServiceRegistry under category 4 (`prediction`) and rail `X402`.
4. The listing starts provider-listed and unverified. `VERIFIER_ROLE` remains unassigned, so it is not escrow-eligible.

