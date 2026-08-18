# Circle Gateway and ERC-1271 research

Status: primary-source research captured on 2026-08-17. This document is an input to the later Agon payment phase. It is not implementation approval and does not prove the behavior of the project’s installed SDK version.

## Sources

- [Transfer USDC from a smart contract account](https://developers.circle.com/gateway/howtos/transfer-with-erc-1271)
- [ERC-1271 programmable authorization](https://developers.circle.com/gateway/references/erc-1271)
- [Transfer a unified USDC balance](https://developers.circle.com/gateway/howtos/transfer-unified-usdc-balance)
- [Manage delegates](https://developers.circle.com/gateway/howtos/manage-delegates)
- [Gateway technical guide](https://developers.circle.com/gateway/references/technical-guide)
- [Circle Gateway](https://developers.circle.com/gateway)
- [ERC-1271 standard](https://eips.ethereum.org/EIPS/eip-1271)

## Verified ground truth

1. Standard Gateway unified-balance transfers support smart contract accounts on EVM chains through ERC-1271. A Circle SCA can authorize its own burn intent without a separate EOA delegate.
2. Each Gateway transfer item opts into contract validation with `contractSigner: true`. `sourceSigner` is the SCA address, and the signature remains opaque bytes. Gateway expects the contract’s read-only `isValidSignature(bytes32,bytes)` call to return `0x1626ba7e`.
3. This support does not extend to Circle Agent Stack nanopayments or x402 batch settlement. Those burn intents use ERC-3009 and do not support ERC-1271. Agon must model standard Gateway transfers and nanopayments as distinct authorization rails.
4. Gateway validates ERC-1271 offchain inside an AWS Nitro Enclave against a quorum of independent RPC providers. The current documentation states that at least two of three providers must agree.
5. Validation is read-only and may use a block up to five minutes old. An authorization contract cannot depend on modifying state during `isValidSignature`, and key rotation or revocation may take up to five minutes to affect Gateway validation.
6. Delegation is optional for an SCA that signs directly. A delegate may be an EOA or ERC-1271 contract, but it receives full authority to sign burn intents for the depositor’s balance on each wallet contract where it is added.
7. Delegate removal prevents new Gateway API authorization after finalization, but burn intents signed before removal remain executable until they expire. Revocation is therefore not retroactive.
8. Gateway balances are tracked by blockchain, token, and depositor in an eventually consistent offchain ledger backed by finalized onchain events. Pending deposits must remain separate from available balance in application state.
9. USDC must be deposited using a Gateway Wallet deposit method. A plain ERC-20 transfer to the Gateway Wallet can permanently lose the funds. An `approve` plus `deposit` path is two separate transactions and must expose two separate receipt states.
10. Burn intents include an expiry block, maximum fee, and transfer specification. The transfer-spec `keccak256` hash is the crosschain identifier and replay-protection value. Gateway attestations currently expire after ten minutes, and one transfer request may contain at most sixteen burn intents.
11. Gateway is non-custodial and documents a delayed trustless withdrawal path. The current delay is seven days.

## Corrected ArcRun assumption

The earlier ArcRun research conclusion that a Circle SCA always needs an EOA delegate to spend a Gateway unified balance is superseded for standard Gateway transfers. Current Circle documentation explicitly supports direct SCA authorization through ERC-1271.

The narrower conclusion remains valid for nanopayments and x402 batch settlement: ERC-1271 is not supported on that rail.

## Agon architecture decision

Keep three authorization modes explicit instead of calling all of them “Gateway”:

1. `gateway_erc1271`: direct SCA authorization for a standard unified-balance transfer.
2. `gateway_eoa`: direct EOA or delegated EOA authorization for a standard transfer.
3. `gateway_nanopayment`: EOA/ERC-3009 authorization for nanopayments and x402 settlement.

Delegates are a high-privilege escape hatch, not the default SCA design. Any delegate workflow needs per-chain registration, an expiry-aware signed-intent ledger, rotation procedures, and a UI warning that removing a delegate does not cancel existing signatures.

## Required proof before implementation

- Inspect and pin the installed `@circle-fin/developer-controlled-wallets` and Gateway integration package versions.
- Confirm `signTypedData` request and response types from the installed SDK source.
- Produce a throwaway Arc Testnet fixture proving SCA deposit, finalized Gateway balance, ERC-1271 burn-intent signing, `contractSigner: true`, attestation retrieval, destination mint, and receipt reconciliation.
- Test a rejected signature, expired burn intent, recently rotated signer, API timeout, pending deposit, insufficient balance, fee above policy, duplicate transfer-spec hash, and already-used attestation.
- Keep private keys, Circle API keys, entity secrets, and wallet approval challenges out of logs, command arguments, fixtures, and model context.
- Add per-transfer and per-day caps, idempotency keys, expiry checks, receipt status checks, and a kill switch before enabling an autonomous agent path.
- Verify whether the intended x402 provider flow needs nanopayments. If it does, do not assume the ERC-1271 SCA path can sign it.
