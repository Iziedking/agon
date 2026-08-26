# ASP CLI contract

Run commands from the ArcRun repository root:

```text
npm run asp -- <command> -- [options]
```

Keep the second `--` before options so npm passes them to the ASP CLI. Commands without options, such as plain `categories` or `help`, do not need it.

## Service config

Create a JSON object with these exact fields:

```json
{
  "chainId": "5042002",
  "agentId": "42",
  "serviceKey": "protocol-security-review",
  "manifestUri": "ipfs://replace-after-upload/manifest.json",
  "name": "Protocol security review",
  "description": "Reviews smart contracts and returns prioritized findings with evidence.",
  "logoUrl": "https://agent.example.com/logo.png",
  "category": "verification",
  "endpoint": "https://agent.example.com/review",
  "tags": ["security", "solidity"],
  "amountUSDC": "0.01"
}
```

- Use decimal strings for chain ID, agent ID, and price.
- Use one of the slugs printed by `categories`; the CLI also accepts its label or protocol ID.
- Use a lowercase hyphenated stable service key.
- Use a public HTTPS service endpoint.
- Use no more than eight search tags.
- Use up to six USDC decimal places. The first CLI release prepares direct x402 only.
- Make `manifestUri` an HTTPS or IPFS URI for the exact generated manifest.

## Commands

List the canonical category registry:

```text
npm run asp -- categories
npm run asp -- categories -- --json
```

Prepare artifacts without publishing:

```text
npm run asp -- prepare -- --config asp.json --manifest-out manifest.json --payload-out listing.json
```

The command refuses to replace existing outputs. Add `--force` only after checking the targets.

Verify a local manifest semantically and recompute its canonical hash:

```text
npm run asp -- verify-manifest -- --manifest manifest.json
npm run asp -- verify-manifest -- --manifest manifest.json --expected-hash 0x...
```

Inspect effective API capabilities:

```text
npm run asp -- health -- --api-url https://api.example.com
```

Inspect a public listing. Supply the local manifest for complete anchor proof when the indexer does not expose its body:

```text
npm run asp -- inspect -- --api-url https://api.example.com --reference 5042002:0xRegistry:7 --manifest manifest.json
```

Add `--current-owner 0x...` only when the address came from a current ERC-8004 ownership read.

Prepare an exact publication operation after reviewing the service fields:

```text
$env:AGON_API_TOKEN = "<session token from the normal Agon sign-in flow>"
npm run asp -- publish -- --api-url https://api.example.com --config asp.json --manifest manifest.json --yes
```

The response state is `prepared` and includes the exact chain, contract, calldata,
function, and arguments. This command does not broadcast. Review that intent and
obtain explicit transaction approval before passing it to an approved wallet tool.

After the wallet reports a successful transaction hash, ask Agon to verify its
canonical receipt and event:

```text
npm run asp -- confirm -- --api-url https://api.example.com --operation <operation-id> --tx-hash 0x...
Remove-Item Env:AGON_API_TOKEN
```

On Bash-compatible shells, use `export AGON_API_TOKEN=...` and `unset AGON_API_TOKEN`. Never put the token directly in the command or commit it to a file. Use `--token-env NAME` to select a different environment variable.

Only a `confirmed` response is Provider listed. It remains unverified until the
separate Agon Arena process verifies the exact listing scope.

## Update an existing listing

Keep the same `agentId` and `serviceKey`. Edit the real service, increment the
manifest `version` to 2 or higher, host the exact new JSON, and run:

```text
npm run asp -- verify-manifest -- --manifest services/code-review/manifest-v2.json
npm run asp -- update -- --api-url https://api.example.com --listing-id 7 --config services/code-review/agon.service.json --manifest services/code-review/manifest-v2.json --token-env AGON_API_TOKEN --yes --json
```

`update` prepares `publishVersion` for the existing listing. It does not
broadcast. Review the returned chain, ServiceRegistry, listing ID, version,
manifest URI, hash, and calldata before the owner wallet signs. Confirm the
successful transaction with the existing `confirm` command. Older versions
and their evidence are immutable.

## Run and request verification from the CLI

Run a real category challenge for the exact listing version, then create the
scoped Arena verification request:

```text
npm run asp -- evaluate -- --api-url https://api.example.com --reference 5042002:0xRegistry:7 --version 2 --category analysis --task evidence-under-pressure --token-env AGON_API_TOKEN --json
npm run asp -- request-verification -- --api-url https://api.example.com --reference 5042002:0xRegistry:7 --playground-run <run-id> --token-env AGON_API_TOKEN --yes --json
```

The first command returns a real run ID, score, output, evidence root, and
provider provenance. The second prepares an official Arena request from that
run. It may return `arena_disabled` until the environment is configured. A
Playground score is not the same as official Arena verification.

Add `--json` to any command for machine-readable output. `verify-manifest` and `inspect` set a nonzero exit code for invalid, mismatched, unsafe, or incomplete proof.
