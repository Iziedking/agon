# Agon Coder demo run

This is the shortest honest demo path for the live agent, listing, and Arena proof loop.

## Start locally

From the repository root:

```powershell
npm run stack:up
npm run migrate
npm run auth
```

In a second terminal:

```powershell
npm run dev:frontend
```

Open `http://localhost:3000/agon/playground`.

## Show the real agent

1. Choose Development, Research, Analysis, Verification, or Execution.
2. Select the adversarial task.
3. Click `RUN REAL AGENT`.
4. Show the structured result, score, block number where applicable, evidence root, response hash, and task commitment.
5. Change the input to a malformed or unsafe value and run again. The agent should reject it and the evidence should change.

The run performs no payment and no blockchain write. It is a real backend agent runtime with explicit no-write provenance.

## Show the CLI agent workflow

The CLI preparation path is read-only until publication is explicitly reviewed:

```powershell
npm run asp -- categories
npm run asp -- prepare -- --config demo/agon-coder/asp.json --manifest-out demo/agon-coder/manifest.json --payload-out demo/agon-coder/listing.json --force
npm run asp -- verify-manifest -- --manifest demo/agon-coder/manifest.json
npm run asp -- demo-run -- --api-url http://localhost:8082 --category development --task selector-guard --json
```

The prepared config uses the existing demo fixture identity `agentId: 42`. Replace it with the ERC-8004 agent ID actually owned by the wallet used for the video before publication. The manifest URI is served from the Agon public site after the frontend deployment.

## Publish only after reviewing the exact intent

Use a normal Agon session token in an environment variable. Never put a token or key in a command argument:

```powershell
$env:AGON_API_TOKEN = "<session token from Agon sign-in>"
npm run asp -- publish -- --api-url http://localhost:8082 --config demo/agon-coder/asp.json --manifest demo/agon-coder/manifest.json --token-env AGON_API_TOKEN --yes --json
Remove-Item Env:AGON_API_TOKEN
```

The result is `prepared`, not Provider listed. Review the exact chain, service registry, function, arguments, manifest hash, and operation ID. The wallet owner must then broadcast that exact `publish` transaction. Confirm the successful receipt with:

```powershell
$env:AGON_API_TOKEN = "<session token from Agon sign-in>"
npm run asp -- confirm -- --api-url http://localhost:8082 --operation <operation-id> --tx-hash <successful-arc-tx-hash> --token-env AGON_API_TOKEN --json
Remove-Item Env:AGON_API_TOKEN
```

Only `confirmed` means Provider listed. It does not mean Verified.

## Show Arena proof

After the listing is indexed, select it in the Arena Anchor panel and click `REQUEST ARENA EVALUATION`. The wallet signs the exact run-scoped request. Then use `START`, `SUBMIT`, and `SCORE` with the configured evaluator role. The resulting Arena evaluation pins the listing ID, agent ID, version, category, manifest hash, task commitment, evidence root, and score.

The deployed Arena still requires `EVALUATOR_ROLE` for start and score. Grant that role only to the reviewed evaluator wallet through the Agon operator console before the video. Do not present a Provider listed state as a Verified state.
