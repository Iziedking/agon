/// Source-grounded fact corpus for LLM puzzle generation. Every fact here is
/// verified against a real source (Arc docs, Circle docs/whitepapers, or
/// well-established EVM/DeFi/security references) and carries a `source` label
/// that ships with the generated puzzle. The generator turns one fact into a
/// varied, world-class multiple-choice question, and a second grader LLM must
/// answer it the same way before it enters the pool, so a hallucinated answer
/// can never reach a contest.
///
/// Re-verify the Arc and Circle facts if those products ship changes. Facts
/// pulled 2026-06-14 from the Arc docs MCP (arc-chain network details, system
/// overview, gas-and-fees, stablecoin-native-model, contract addresses) and
/// the Circle CCTP V2 technical guide + whitepaper.

export type CorpusCategory = "arc" | "circle" | "evm" | "defi" | "security";

export interface CorpusFact {
  id: string;
  category: CorpusCategory;
  /// A precise, true statement. The generator grounds a question in this and
  /// must not contradict it.
  fact: string;
  /// Human-readable provenance, shown with the puzzle ("Source: Arc docs").
  source: string;
}

export const SOURCE_CORPUS: CorpusFact[] = [
  // ----- Arc (Arc docs) -----
  { id: "arc-chainid", category: "arc", fact: "Arc Testnet's chain ID is 5042002.", source: "Arc docs: network details" },
  { id: "arc-gas", category: "arc", fact: "Arc uses USDC as its native gas token, so no separate gas coin is needed.", source: "Arc docs: network details" },
  { id: "arc-decimals", category: "arc", fact: "On Arc, the native USDC gas accounting uses 18 decimals while the USDC ERC-20 interface uses 6 decimals, and both share the same underlying balance.", source: "Arc docs: stablecoin-native model" },
  { id: "arc-usdc-addr", category: "arc", fact: "The USDC ERC-20 interface on Arc is at address 0x3600000000000000000000000000000000000000.", source: "Arc docs: contract addresses" },
  { id: "arc-consensus", category: "arc", fact: "Arc's consensus is Malachite, a high-performance implementation of the Tendermint BFT protocol.", source: "Arc docs: consensus layer" },
  { id: "arc-poa", category: "arc", fact: "Arc runs a permissioned Proof-of-Authority validator set, while developer access is permissionless.", source: "Arc docs: system overview" },
  { id: "arc-finality", category: "arc", fact: "Arc has deterministic, sub-second finality with no reorganization risk.", source: "Arc docs: network details" },
  { id: "arc-blocktime", category: "arc", fact: "Arc Testnet's block time is about 0.48 seconds.", source: "Arc docs: network details" },
  { id: "arc-quorum", category: "arc", fact: "Malachite requires more than two-thirds of validators to agree, across a pre-vote and pre-commit phase, before a block is committed and final.", source: "Arc docs: system overview" },
  { id: "arc-fees", category: "arc", fact: "Arc prices gas with EIP-1559 plus EWMA smoothing of block utilization, so short traffic spikes do not cause sudden fee jumps.", source: "Arc docs: gas and fees" },
  { id: "arc-feetarget", category: "arc", fact: "Arc's base fee has a design-time target of about $0.01 per transaction under normal load.", source: "Arc docs: gas and fees" },
  { id: "arc-eip7708", category: "arc", fact: "Every USDC movement on Arc, native send or ERC-20 transfer, emits a standard ERC-20 Transfer log via Arc's EIP-7708 implementation, giving indexers one source of truth.", source: "Arc docs: stablecoin-native model" },
  { id: "arc-evm", category: "arc", fact: "Arc's execution environment is the EVM at the Osaka hard fork.", source: "Arc docs: network details" },
  { id: "arc-explorer", category: "arc", fact: "Arc Testnet's block explorer is testnet.arcscan.app and testnet USDC comes from the Circle faucet at faucet.circle.com.", source: "Arc docs: RPC endpoints" },

  // ----- Circle (CCTP V2 + products) -----
  { id: "cctp-burnmint", category: "circle", fact: "Circle's CCTP moves USDC across chains with a burn-and-mint model, burning on the source chain and minting native USDC on the destination, rather than locking in escrow.", source: "Circle CCTP technical guide" },
  { id: "cctp-attest", category: "circle", fact: "CCTP message passing has three steps: the source domain emits a message, Circle's offchain attestation service signs it, and the destination domain receives it.", source: "Circle CCTP technical guide" },
  { id: "cctp-iris", category: "circle", fact: "Circle's offchain attestation service for CCTP is named Iris.", source: "Circle CCTP technical guide" },
  { id: "cctp-domain", category: "circle", fact: "In CCTP, each supported blockchain is referred to as a domain.", source: "Circle CCTP technical guide" },
  { id: "cctp-evm", category: "circle", fact: "On EVM domains, CCTP's burn-and-mint component is TokenMessengerV2, built on top of MessageTransmitterV2 for generalized message passing.", source: "Circle CCTP V2 contracts" },
  { id: "cctp-fast", category: "circle", fact: "CCTP V2 introduces Fast Transfers that are attested faster than source-chain finality, backed by a shared over-collateralization pool to guard against reorgs.", source: "Circle CCTP V2 whitepaper" },
  { id: "cctp-hooks", category: "circle", fact: "CCTP V2 Hooks let arbitrary actions execute atomically with a USDC transfer on the destination chain.", source: "Circle CCTP V2 whitepaper" },
  { id: "circle-gateway", category: "circle", fact: "Circle Gateway gives a unified USDC balance that can be spent on any supported chain without bridging first.", source: "Circle Gateway docs" },
  { id: "circle-devwallet", category: "circle", fact: "Circle Developer-Controlled Wallets keep custody of the wallet keys with the developer on behalf of end users.", source: "Circle Wallets docs" },
  { id: "circle-modular", category: "circle", fact: "Circle Modular Wallets use passkey (WebAuthn) authentication and can send gasless transactions through a paymaster.", source: "Circle Modular Wallets docs" },
  { id: "circle-usdc", category: "circle", fact: "USDC is a fully-reserved dollar stablecoin issued by Circle, redeemable one-to-one for US dollars.", source: "Circle USDC docs" },

  // ----- EVM / DeFi / security (well-established) -----
  { id: "evm-selector", category: "evm", fact: "The ERC-20 transfer function has the 4-byte selector 0xa9059cbb.", source: "EVM / ERC-20 standard" },
  { id: "evm-word", category: "evm", fact: "The EVM operates on 32-byte (256-bit) words.", source: "EVM yellow paper" },
  { id: "evm-erc721", category: "evm", fact: "ERC-721 is the Ethereum standard for non-fungible tokens, where each token has a unique id.", source: "EIP-721" },
  { id: "defi-cpmm", category: "defi", fact: "A constant-product automated market maker keeps the product of its two reserves constant, x times y equals k.", source: "AMM / Uniswap v2 design" },
  { id: "defi-slippage", category: "defi", fact: "Slippage is the difference between a trade's expected price and the price actually executed, and it grows with trade size relative to pool depth.", source: "DeFi AMM concepts" },
  { id: "sec-reentrancy", category: "security", fact: "A reentrancy bug lets an external call re-enter a contract before its state is updated; the checks-effects-interactions pattern prevents it by updating state before the external call.", source: "Smart contract security" },
  { id: "sec-overflow", category: "security", fact: "Solidity 0.8 and later revert on integer overflow and underflow by default, removing the need for SafeMath.", source: "Solidity 0.8 release notes" },
  { id: "x402-status", category: "evm", fact: "The x402 payment protocol is built on the HTTP 402 Payment Required status code, letting a server demand a stablecoin payment before serving a request.", source: "x402 protocol" },
];

/// Facts eligible for a difficulty band. Knowledge questions don't have a clean
/// numeric difficulty, so we treat Arc/Circle protocol facts as the harder,
/// product-specific set and the general EVM/DeFi/security facts as the standard
/// set. Hard rounds prefer the protocol facts; easy rounds prefer the basics.
export function corpusForDifficulty(difficulty: 1 | 2 | 3): CorpusFact[] {
  if (difficulty >= 3) {
    const hard = SOURCE_CORPUS.filter((f) => f.category === "arc" || f.category === "circle");
    return hard.length >= 4 ? hard : SOURCE_CORPUS;
  }
  if (difficulty <= 1) {
    const easy = SOURCE_CORPUS.filter((f) => f.category === "evm" || f.category === "defi");
    return easy.length >= 4 ? easy : SOURCE_CORPUS;
  }
  return SOURCE_CORPUS;
}
