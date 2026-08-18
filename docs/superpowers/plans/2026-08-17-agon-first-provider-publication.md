# Agon first-provider publication plan

Status: implementation and a correctly named inspection preview are authorized by the user's 2026-08-17 “proceed”; production DNS/backend deployment, Circle submission, and blockchain transactions remain separately gated.

1. Replace the superseded ArcRun provider identity and `arcrun.xyz` URIs with Agon and `agon.surf` in the typed publication module, tests, route paths, seller description, and evidence.
2. Give `/market` an Agon-specific navigation, footer, wallet name, metadata, and deployment mode while preserving the legacy ArcRun arena routes.
3. Add canonical `api.agon.surf` and `ws.agon.surf` ingress blocks without removing the legacy host blocks.
4. Pin the new canonical manifest hash, rerun the local fork proof, and regenerate all calldata/gas evidence because URI and manifest bytes changed.
5. Run focused tests, full Agon/marketplace suites, typechecks, production frontend build, Compose/Caddy validation, HTTP route smoke tests, boundary checks, and diff checks.
6. Create or link the isolated Vercel project `agon`, deploy an Agon-configured preview, and verify its public marketplace and well-known resources.
7. Attach `agon.surf` only after the preview is sound. Report the exact DNS records still required; do not pretend the parked domain or absent API record is production-ready.
8. After frontend and backend HTTPS checks pass, refresh the mutable ERC-8004 agent ID, balance, nonce, calldata, and gas estimates, then request exact approval before any transaction.

