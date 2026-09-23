# AGON build audit — 22 September 2026

## Release decision

**Hold the MCP publishing claim.** The failed `main` workflow was caused by a
Node type-stripping import error in the AGON route test. The local fix removes
that runtime import. The audit also found that native MCP accepted scoped CLI
tokens without checking tool scopes, and that prepared publication operations
discarded the calldata a publisher wallet needs. Those defects are fixed in
the current worktree, with focused regression tests.

The current server still does **not** provision a self-owned publisher wallet,
fund it, register an ERC-8004 identity, or broadcast its transaction. A provider
must supply a wallet and a public HTTPS manifest URI. AGON prepares the exact
transaction and independently confirms its receipt after that wallet broadcasts.
The user-facing product must describe this boundary as it is.

## Evidence

| Area | Result |
| --- | --- |
| GitHub Actions run `35765454141` | `verify` failed at `backend/test/agon/routes.test.ts`: `auth/jwt.ts` imported `../config/index.js` under Node 22 type stripping. Deploy was skipped. |
| AGON route regression | Local route tests passed 40/40 after injecting the JWT verifier from the auth bootstrap. |
| Native MCP authentication | Validated bearer claims reach MCP; invalid tokens do not. CLI tool scopes now gate reads, publication preparation, confirmation, and payment authorization. |
| Provider publication | MCP preparation now returns chain ID, target, calldata, function, and arguments. A separate `confirm_pause` checks the matching receipt and listing reference. Focused MCP tests passed 10/10 after this change. |
| Backend suite | Passed 432/432 against the local isolated Postgres test database on the final audit source. |
| Frontend marketplace suite | Passed 48/48. |
| Typechecks | Backend and frontend passed. |
| Frontend production build | Passed after the final landing and publication-copy changes; 37 pages generated. |

## Open release checks

1. Confirm the deployed MCP and auth services use the same build. Local tests do
   not prove production deployment, provider wallet signing, or onchain receipt
   finality.
2. Test one real publisher wallet end to end on Arc Testnet, including a hosted
   manifest whose hash matches the published version. The existing hosted Nock
   and Agent QA service files have previously drifted from their immutable
   listing hashes; the current production state has not been rechecked here.
3. Test a real x402 payment and delivery before claiming that an MCP approval
   completes a hire. The approval response is only an approval record.
4. Implement and test the self-owned publisher-wallet rail, missing ERC-8004
   registration, and receipt-to-agent-ID handoff before saying MCP can fully
   publish an agent from a new wallet. The wallet needs native gas before
   registration and publication. Do not substitute AGON's platform Circle
   Developer-Controlled wallet for the provider's wallet.
5. The MCP draft check validates fields and HTTPS syntax; it does not run live
   endpoint QA. The provider manifest compiler currently hardcodes service
   version `1`, including when preparing a listing-version update. Validate the
   next version against the existing listing before releasing version updates.
6. The wider AGON market aims to aggregate agent marketplaces. Add each source
   through a checked adapter with source identity, freshness, ownership, terms,
   and version provenance. Do not imply a connected marketplace or import its
   trust claims as AGON verification before that adapter is live and tested.

No production configuration, deployment, wallet transaction, or Git write was
performed during this audit.
