# Agon ASP CLI and coding-agent skill

## Status

Implementation approved by the user's instruction to proceed to the next build on 2026-08-17.

## Goal

Let a coding agent prepare, publish, inspect, and verify an ASP service listing through deterministic commands that use the same category registry, manifest serializer, API shapes, and trust language as Agon Market.

## Locked decisions

- Keep the product term as `ASP`. Do not invent an expansion until product terminology is formally locked.
- Ship the first CLI inside the existing frontend package so it imports the marketplace's category, draft, canonicalization, and assurance modules directly. Do not create a second protocol mapping.
- Ship the discoverable skill at `.agents/skills/agon-asp` with concise instructions and one command reference.
- Never accept a private key, seed phrase, or raw bearer token as a command-line argument. Read an existing Agon session token only from an environment variable.
- Treat publication and verification as separate facts. A successful publication starts as `Provider listed`; only scoped Agon verification may produce `Verified`.
- Check `/agon/health` before a write. Refuse honestly when `listingWrites` is false.
- Require explicit `--yes` confirmation before a publication request. Verification and preparation remain read-only.
- Do not dereference a listing's arbitrary manifest URI automatically. Verify an indexed manifest body or an explicit local manifest file.
- Keep direct x402 as the first CLI payment rail. Escrow remains unavailable until the verified settlement phase exists.

## Commands

- `categories`: print the versioned marketplace registry.
- `prepare --config <file>`: validate a service config and print or write the exact manifest, canonical hash, service-key hash, and listing request. Repository invocations place a second `--` before CLI options so npm forwards them unchanged.
- `verify-manifest --manifest <file> [--expected-hash <hash>]`: validate and hash a local manifest.
- `inspect --reference <chain:registry:listing> [--manifest <file>]`: read the public listing, recompute available proof, and report assurance, payment, risk, and provenance.
- `publish --config <file> --manifest <file> --yes`: confirm the local artifact matches the prepared manifest, check capabilities, then submit with a bearer token read from `AGON_API_TOKEN` or the selected `--token-env` name.
- `health`: print the API's effective capabilities.

## File sequence

1. Add CLI behavior tests beside the existing Agon browser tests.
2. Add a pure ASP preparation and reporting module under `frontend/src/lib/agon`.
3. Add the Node CLI entrypoint under `frontend/scripts` and package scripts.
4. Initialize `.agents/skills/agon-asp`, then replace the generated placeholders with the final workflow and command reference.
5. Update `docs/AGON.md` with commands, safety boundaries, and the current write-capability limitation.

## Definition of done

- Focused CLI and marketplace tests pass.
- Frontend typecheck and production build pass.
- Skill validation passes with the system skill validator.
- CLI smoke checks cover categories, preparation at `0.01 USDC`, matching proof, mismatching proof refusal, unavailable write capability, and machine-readable JSON output.
- No command exposes secrets, implies verification, signs transactions, or bypasses backend capability checks.
- No commit, push, deployment, or onchain transaction is performed.
