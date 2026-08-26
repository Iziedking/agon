---
name: agon-asp
description: Build, update, publish, inspect, and request verification for service listings in Agon Market through the repository CLI. Use when a coding agent needs to turn a service into an x402 manifest, choose a category, create an immutable listing version, prepare an owner-wallet transaction, run a scoped Playground test, request Arena verification, or distinguish Provider listed, Verified, Quarantined, stale-ownership, and manifest-mismatch states.
---

# Agon ASP

Use Agon's deterministic ASP CLI. Keep preparation and verification read-only. Treat publication as an external state change that requires the user's explicit approval.

## Install the skill

Install the public package into detected coding agents with:

```text
npx skillfish add Iziedking/agon --path .agents/skills/agon-asp --yes
```

The same package is downloadable from the Agon BUILD guide at `/downloads/agon-asp.zip`. Review the package before use. Never put private keys, seed phrases, or session tokens in the skill, a repository, a CLI argument, or a chat message. A Web3 private key may be supplied to the local CLI only through a protected environment variable when the user explicitly chooses CLI signing; it is never sent to Agon or logged.

## Load the command contract

Read [references/cli.md](references/cli.md) before preparing, publishing, or verifying a service. Use its config schema and exact commands.

## Follow the workflow

1. Confirm the current directory is the Agon repository root and `frontend/package.json` exposes the `asp` script.
2. Run `npm run asp -- categories` and select by plain-language buyer intent. Never type or maintain a separate numeric category map.
3. Inspect the provider's actual service implementation. If it is a new service, create it with `init` and replace the sample implementation. If it already exists, preserve its ERC-8004 `agentId`, stable `serviceKey`, public listing reference, and trust history.
4. Create or update the ASP config from observed facts. Do not invent endpoints, capabilities, prices, ownership, or manifest URIs. For a new service, run `prepare`. For an existing service update, edit the implementation and manifest, increment the manifest's integer `version` to 2 or higher, then use `update`.
5. Have the provider upload that exact manifest to its permanent HTTPS or IPFS URI. Run `verify-manifest` against the local artifact before any publication request.
6. Run `health`. If `listingWrites` is false, stop and report that publication is unavailable. Preserve the generated artifacts; do not imply a transaction.
7. Before `publish`, show the agent ID, service name, category, endpoint host, price, manifest URI, manifest hash, and initial trust state. Ask for explicit approval if the user has not already authorized this exact publication.
8. Read the session token from an environment variable. For the full build, update, Playground, and verification workflow, request only the required device scopes: `agon:read`, `listing:prepare`, `listing:write`, `listing:confirm`, `wallet:execute`, `playground:run`, and `arena:prepare`. Never request or accept a token in a CLI argument, file, prompt, or chat response.
9. Run `publish` or `update` only with the reviewed config, matching local manifest, and `--yes`. Without `--signer`, it creates a durable `prepared` operation and exact transaction intent but does not broadcast.
10. For Circle-managed email users, use `--signer circle --yes`. The CLI submits only the exact prepared call through Circle and polls for the receipt. The human must approve the command with `--yes`; Circle credentials and key material stay on the server.
11. For Web3 users who intentionally choose terminal-only signing, use `--signer private-key --private-key-env AGON_PRIVATE_KEY --rpc-url https://... --yes`. The CLI reads the key only from that environment variable, checks that its address matches the authenticated Agon wallet and that the RPC chain matches the prepared operation, signs only the prepared calldata, waits for a successful receipt, and confirms it. Never print, paste, commit, or transmit the key.
12. Show the exact chain, contract, function, arguments, and operation ID before any signer runs. `--yes` is required for both Circle and Web3 signing and is the human approval boundary. After a successful transaction, report Provider listed only when AGON returns `confirmed` receipt proof. Never report it as Agon verified.
13. Run `inspect` with the confirmed listing reference and local manifest. Report hash evidence, scoped trust state, payment eligibility, quarantine reason, ownership freshness when supplied, and provenance separately.

## Update an existing agent

An update never replaces an old record and never needs a new ERC-8004 identity. Keep the same `agentId` and `serviceKey`, deploy the improved service, increment the manifest `version`, and publish a new immutable listing version:

```text
npm run asp -- verify-manifest -- --manifest services/my-agent/manifest-v2.json
npm run asp -- update -- --api-url https://api.agon.surf --listing-id 7 --config services/my-agent/agon.service.json --manifest services/my-agent/manifest-v2.json --token-env AGON_API_TOKEN --yes --json
```

The update command checks that the local manifest exactly matches the reviewed config and returns a `prepared` operation. The coding agent must show the chain, ServiceRegistry, `publishVersion` call, listing ID, new version, manifest URI, and canonical hash. Use `--signer circle --yes` for a Circle-managed wallet or `--signer private-key --private-key-env AGON_PRIVATE_KEY --rpc-url https://... --yes` for an explicitly approved Web3 terminal signer. Without a signer, the owner signs in the UI and the agent runs `confirm` afterward. The old version, scores, receipts, and evidence remain attached to their original version.

## Run a real test and request verification

After a confirmed listing version is live, run the exact category challenge through the approved provider scope:

```text
npm run asp -- evaluate -- --api-url https://api.agon.surf --reference 5042002:0xServiceRegistry:7 --version 2 --category analysis --task evidence-under-pressure --token-env AGON_API_TOKEN --json
npm run asp -- request-verification -- --api-url https://api.agon.surf --reference 5042002:0xServiceRegistry:7 --playground-run <run-id> --token-env AGON_API_TOKEN --yes --json
```

`evaluate` returns the real run ID, score, output, evidence root, provider host, and exact listing scope. `request-verification` creates the scoped Arena evaluation request from that run and returns the owner-wallet transaction intent. It may be unavailable until Agon Arena is enabled for the environment. A Playground result is evidence for the version, not proof that the official Arena record is already verified. Any Arena transaction must be reviewed and signed by the owner wallet, then reconciled through the Arena workflow.

## Monitor a published agent

Keep the same `agentId`, service key, listing reference, manifest, category, and version when comparing an agent over time. Use the following read paths:

- Run `health` to check API reachability and whether listing or verification capabilities are available.
- Run `inspect` with the exact local manifest to compare the immutable anchor, endpoint QA, trust state, payment eligibility, risk, and provenance.
- Run the category Playground or `demo-run` to produce a scoped score and evidence record for the published version.
- Read the Market and operator activity surfaces for the current version, settlement state, and operational events.

Treat a score as evidence for one exact version only. Do not compare scores across different manifests without recording the version and category. Do not call a listing safe when evidence is unavailable, quarantined, stale, or mismatched.

## Interpret trust correctly

- `Provider listed` or `UNVERIFIED`: the provider published the service. Direct x402 may be available. Agon has not verified it.
- `VERIFIED`: the listing's exact agent, listing, version, and category scope has current Agon verification.
- `QUARANTINED`, `ANCHOR MISMATCH`, or `STALE OWNERSHIP`: treat the listing as unsafe. Do not recommend payment or escrow.
- `unavailable` manifest evidence: say local recomputation could not be completed. Do not infer a match from a URI or onchain hash alone.

Never claim escrow readiness unless the API reports it and the CLI returns coherent verified evidence. Never expand the acronym `ASP` until Agon locks the product terminology.
