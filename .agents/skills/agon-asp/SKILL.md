---
name: agon-asp
description: Prepare, publish, inspect, and verify ASP service listings in Agon Market through the repository CLI. Use when a coding agent needs to turn a service into an x402 manifest, choose an Agon marketplace category, compute canonical manifest and service-key hashes, submit a provider listing, inspect public listing evidence, or distinguish Provider listed, Verified, Quarantined, stale-ownership, and manifest-mismatch states.
---

# Agon ASP

Use Agon's deterministic ASP CLI. Keep preparation and verification read-only. Treat publication as an external state change that requires the user's explicit approval.

## Install the skill

Install the public package into detected coding agents with:

```text
npx skillfish add Iziedking/agon --path .agents/skills/agon-asp --yes
```

The same package is downloadable from the Agon BUILD guide at `/downloads/agon-asp.zip`. Review the package before use. Never put private keys, seed phrases, or session tokens in the skill, a repository, a CLI argument, or a chat message.

## Load the command contract

Read [references/cli.md](references/cli.md) before preparing, publishing, or verifying a service. Use its config schema and exact commands.

## Follow the workflow

1. Confirm the current directory is the Agon repository root and `frontend/package.json` exposes the `asp` script.
2. Run `npm run asp -- categories` and select by plain-language buyer intent. Never type or maintain a separate numeric category map.
3. Inspect the provider's actual service implementation and create an ASP config from observed facts. Do not invent endpoints, capabilities, prices, ownership, or manifest URIs.
4. Run `npm run asp -- prepare` to generate the exact manifest and listing payload. Start x402 price examples at `0.01 USDC` unless the provider specifies another amount.
5. Have the provider upload that exact manifest to its permanent HTTPS or IPFS URI. Run `verify-manifest` against the local artifact before any publication request.
6. Run `health`. If `listingWrites` is false, stop and report that publication is unavailable. Preserve the generated artifacts; do not imply a transaction.
7. Before `publish`, show the agent ID, service name, category, endpoint host, price, manifest URI, manifest hash, and initial trust state. Ask for explicit approval if the user has not already authorized this exact publication.
8. Read the session token from an environment variable. Never request or accept a private key, seed phrase, or token in a CLI argument, file, prompt, or chat response.
9. Run `publish` only with the reviewed config, matching local manifest, and `--yes`. It creates a durable `prepared` operation and exact transaction intent; it does not broadcast and is not yet Provider listed.
10. Show the exact chain, contract, function, arguments, and operation ID before using an approved wallet tool. A real transaction requires explicit approval for that exact intent. Never handle a private key or seed phrase.
11. After the transaction succeeds, run `confirm` with the operation ID and transaction hash. Report Provider listed only when the backend returns `confirmed` receipt proof. Never report it as Agon verified.
12. Run `inspect` with the confirmed listing reference and local manifest. Report hash evidence, scoped trust state, payment eligibility, quarantine reason, ownership freshness when supplied, and provenance separately.

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
