/// Quiz question bank used by the SOLVER contest's quiz puzzle family.
/// Large enough that a 5-puzzle round rarely repeats. Mix is ~60% Arc and
/// Circle, ~40% general blockchain.
///
/// Every question is multiple choice (A/B/C/D). Judging is deterministic
/// (extract the last letter from the LLM response and compare).
///
/// Facts verified against Arc docs (testnet specs, Malachite consensus,
/// EWMA fee model, USDC native gas, ERC-8004 addresses) and Circle docs
/// (CCTP V2, Gateway, wallet products, USDC decimals). Re-verify the bank
/// if Arc or Circle ship product changes.

export type QuizCategory = "arc" | "circle" | "evm" | "defi" | "security";

export interface QuizQuestion {
  category: QuizCategory;
  question: string;
  /// Always exactly four choices, presented as A/B/C/D in the prompt.
  choices: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
}

export const QUIZ_BANK: QuizQuestion[] = [
  // ----- ARC -----
  {
    category: "arc",
    question: "What is Arc Testnet's chain ID?",
    choices: ["5042001", "5042002", "5042003", "5042042"],
    correctIndex: 1,
  },
  {
    category: "arc",
    question: "Which token does Arc use as its native gas?",
    choices: ["ETH", "ARC", "USDC", "USDT"],
    correctIndex: 2,
  },
  {
    category: "arc",
    question: "What consensus protocol powers Arc?",
    choices: ["Proof of Work", "Malachite BFT", "Nakamoto PoS", "Casper FFG"],
    correctIndex: 1,
  },
  {
    category: "arc",
    question: "Which Ethereum client does Arc use for its execution layer?",
    choices: ["Geth", "Erigon", "Reth", "Nethermind"],
    correctIndex: 2,
  },
  {
    category: "arc",
    question: "What kind of finality does Arc provide?",
    choices: [
      "Probabilistic after 12 blocks",
      "Deterministic, sub-second",
      "Eventual after one epoch",
      "Optimistic with 7-day challenge",
    ],
    correctIndex: 1,
  },
  {
    category: "arc",
    question: "How many decimals does USDC use for native gas accounting on Arc?",
    choices: ["6", "8", "12", "18"],
    correctIndex: 3,
  },
  {
    category: "arc",
    question: "How many decimals does USDC use on its ERC-20 interface on Arc?",
    choices: ["6", "8", "12", "18"],
    correctIndex: 0,
  },
  {
    category: "arc",
    question: "What validator model does Arc launch with?",
    choices: [
      "Permissionless PoS",
      "Delegated PoS",
      "Permissioned PoA",
      "Centralized sequencer",
    ],
    correctIndex: 2,
  },
  {
    category: "arc",
    question: "Which fee model does Arc use to keep gas predictable?",
    choices: [
      "Fixed price per byte",
      "Auction with sealed bids",
      "EIP-1559 with EWMA smoothing",
      "Free for all txs",
    ],
    correctIndex: 2,
  },
  {
    category: "arc",
    question: "What standard does Arc use for AI agent identity?",
    choices: ["ERC-721", "ERC-1155", "ERC-8004", "ERC-4337"],
    correctIndex: 2,
  },
  {
    category: "arc",
    question: "What two states can an Arc transaction be in?",
    choices: [
      "Pending or final",
      "Pending, confirming, or finalized",
      "Submitted, mined, then verified",
      "Locked or unlocked",
    ],
    correctIndex: 0,
  },
  {
    category: "arc",
    question: "Which Arc precompile preserves msg.sender across delegated calls?",
    choices: ["CallFrom", "Multicall3", "DelegateAs", "ProxyOf"],
    correctIndex: 0,
  },
  {
    category: "arc",
    question: "What does Arc's USDC blocklist do on a transfer to a blocked address?",
    choices: [
      "Silently drops the call",
      "Burns the value",
      "Reverts the transaction",
      "Routes through a relayer",
    ],
    correctIndex: 2,
  },
  {
    category: "arc",
    question: "Should you send ETH to a relayer on Arc?",
    choices: [
      "Yes, ETH is the gas token",
      "No, ETH has no function on Arc",
      "Only for ERC-20 transfers",
      "Only on weekdays",
    ],
    correctIndex: 1,
  },
  {
    category: "arc",
    question: "Which two-phase vote does Malachite use before committing a block?",
    choices: [
      "Propose and finalize",
      "Pre-vote and pre-commit",
      "Stake and slash",
      "Bid and reveal",
    ],
    correctIndex: 1,
  },
  {
    category: "arc",
    question: "What share of validators must pre-commit for a Malachite block to commit?",
    choices: ["More than half", "Exactly half", "More than two-thirds", "All validators"],
    correctIndex: 2,
  },
  {
    category: "arc",
    question: "Where do you get testnet USDC for Arc?",
    choices: ["Uniswap", "The Circle Faucet", "L1 ETH faucet", "Coinbase Wallet"],
    correctIndex: 1,
  },

  // ----- CIRCLE -----
  {
    category: "circle",
    question: "Who issues USDC?",
    choices: ["Tether", "MakerDAO", "Circle", "Paxos"],
    correctIndex: 2,
  },
  {
    category: "circle",
    question: "What does CCTP do to USDC across chains?",
    choices: [
      "Wraps it as a synthetic token",
      "Burns on source and mints on target",
      "Locks in a multi-sig",
      "Mirrors via an oracle",
    ],
    correctIndex: 1,
  },
  {
    category: "circle",
    question: "Which two transfer modes does CCTP V2 offer?",
    choices: [
      "Fast and Slow",
      "Onchain and Offchain",
      "Sync and Async",
      "Public and Private",
    ],
    correctIndex: 0,
  },
  {
    category: "circle",
    question: "What is the name of Circle's CCTP attestation service?",
    choices: ["Iris", "Aurora", "Orbit", "Anchor"],
    correctIndex: 0,
  },
  {
    category: "circle",
    question: "What problem does Circle Gateway solve?",
    choices: [
      "Wrapping ETH on every chain",
      "Unified USDC balance across multiple chains",
      "Onramps for fiat",
      "Token launches",
    ],
    correctIndex: 1,
  },
  {
    category: "circle",
    question: "Which Circle wallet type is custodial?",
    choices: [
      "Modular Wallets",
      "User-Controlled Wallets",
      "Developer-Controlled Wallets",
      "Hardware Wallets",
    ],
    correctIndex: 2,
  },
  {
    category: "circle",
    question: "Which Circle wallet type splits the key with MPC between user and Circle?",
    choices: [
      "Modular Wallets",
      "User-Controlled Wallets",
      "Developer-Controlled Wallets",
      "Smart Wallets",
    ],
    correctIndex: 1,
  },
  {
    category: "circle",
    question: "Which Circle wallet type is a passkey-backed smart contract account?",
    choices: [
      "Modular Wallets",
      "User-Controlled Wallets",
      "Developer-Controlled Wallets",
      "EOA Wallets",
    ],
    correctIndex: 0,
  },
  {
    category: "circle",
    question: "What does Circle Gas Station do?",
    choices: [
      "Mints new USDC",
      "Sponsors transaction gas fees",
      "Burns failed transactions",
      "Indexes chain activity",
    ],
    correctIndex: 1,
  },
  {
    category: "circle",
    question: "Which SDK does Circle recommend for bridging USDC across chains?",
    choices: [
      "Bridge Kit SDK",
      "viem CCTP plugin",
      "ethers.js CCTP module",
      "Hardhat Bridges",
    ],
    correctIndex: 0,
  },
  {
    category: "circle",
    question: "Which standard underlies Modular Wallets' smart contract accounts?",
    choices: ["ERC-20", "ERC-4337", "ERC-721", "ERC-1155"],
    correctIndex: 1,
  },
  {
    category: "circle",
    question: "How many decimals does USDC use as an ERC-20?",
    choices: ["6", "8", "12", "18"],
    correctIndex: 0,
  },
  {
    category: "circle",
    question: "Which Circle product is best when you want to pool USDC from many chains for one transfer?",
    choices: ["CCTP", "Gateway", "Bridge Kit", "Mint API"],
    correctIndex: 1,
  },
  {
    category: "circle",
    question: "What is Circle Gateway's typical crosschain latency target?",
    choices: ["Under 500 ms", "About 5 minutes", "About 1 hour", "Next day"],
    correctIndex: 0,
  },
  {
    category: "circle",
    question: "Does CCTP V2 support Arc Testnet?",
    choices: ["Yes", "Only after mainnet launch", "Only Slow transfers", "No"],
    correctIndex: 0,
  },
  {
    category: "circle",
    question: "What was the previous name of Circle's User-Controlled and Developer-Controlled wallets?",
    choices: [
      "Programmable Wallets",
      "Smart Wallets",
      "Circle Vault",
      "Circle Pay",
    ],
    correctIndex: 0,
  },
  {
    category: "circle",
    question: "On the Anthropic-style audit trail, what term describes the Circle account that pays gas on behalf of users?",
    choices: ["Bundler", "Paymaster", "Sequencer", "Validator"],
    correctIndex: 1,
  },

  // ----- EVM / GENERAL -----
  {
    category: "evm",
    question: "What hash function does Ethereum use for addressing and signatures?",
    choices: ["SHA-256", "Keccak-256", "Blake2b", "RIPEMD-160"],
    correctIndex: 1,
  },
  {
    category: "evm",
    question: "Which signature scheme do Ethereum wallets use to authorize transactions?",
    choices: ["RSA", "Schnorr", "ECDSA on secp256k1", "EdDSA on Ed25519"],
    correctIndex: 2,
  },
  {
    category: "evm",
    question: "What does the function selector 0xa9059cbb correspond to in ERC-20?",
    choices: ["approve", "transfer", "transferFrom", "balanceOf"],
    correctIndex: 1,
  },
  {
    category: "evm",
    question: "What does EIP-1559 introduce?",
    choices: [
      "Account abstraction",
      "Base fee that burns ETH",
      "Sharding for L1",
      "Optimistic rollups",
    ],
    correctIndex: 1,
  },
  {
    category: "evm",
    question: "Which Solidity variable refers to the immediate caller of a function?",
    choices: ["msg.sender", "tx.origin", "block.coinbase", "msg.signer"],
    correctIndex: 0,
  },
  {
    category: "evm",
    question: "What problem does tx.origin pose compared to msg.sender?",
    choices: [
      "It costs more gas",
      "It opens phishing-style auth bugs",
      "It is deprecated",
      "It always returns zero",
    ],
    correctIndex: 1,
  },
  {
    category: "evm",
    question: "From which Solidity version are integer overflows checked by default?",
    choices: ["0.5.0", "0.6.0", "0.7.0", "0.8.0"],
    correctIndex: 3,
  },
  {
    category: "evm",
    question: "What does ERC-4337 enable?",
    choices: [
      "Token swaps",
      "Account abstraction without protocol changes",
      "ZK rollups",
      "Cross-chain bridges",
    ],
    correctIndex: 1,
  },
  {
    category: "evm",
    question: "What does keccak256(0xa9059cbb...) typically return?",
    choices: [
      "A 256-bit hash",
      "A 160-bit address",
      "A 128-bit checksum",
      "A 32-byte signature",
    ],
    correctIndex: 0,
  },
  {
    category: "evm",
    question: "Which ERC defines non-fungible tokens?",
    choices: ["ERC-20", "ERC-165", "ERC-721", "ERC-1155"],
    correctIndex: 2,
  },
  {
    category: "evm",
    question: "Which ERC defines a multi-token interface for both fungible and non-fungible tokens?",
    choices: ["ERC-20", "ERC-721", "ERC-777", "ERC-1155"],
    correctIndex: 3,
  },

  // ----- DEFI -----
  {
    category: "defi",
    question: "What formula defines a Uniswap v2 constant-product AMM?",
    choices: ["x + y = k", "x * y = k", "x ^ y = k", "x / y = k"],
    correctIndex: 1,
  },
  {
    category: "defi",
    question: "What does slippage measure on a swap?",
    choices: [
      "Network latency",
      "Difference between quoted and executed price",
      "Gas overhead",
      "Block reward dilution",
    ],
    correctIndex: 1,
  },
  {
    category: "defi",
    question: "What is impermanent loss?",
    choices: [
      "Lost gas from failed txs",
      "Divergence between holding and providing liquidity",
      "MEV extraction",
      "Bridging fees",
    ],
    correctIndex: 1,
  },
  {
    category: "defi",
    question: "What keeps USDC pegged to one US dollar?",
    choices: [
      "Algorithmic supply changes",
      "Reserves backing each token one to one",
      "Insurance pool slashing",
      "Floating peg with oracles",
    ],
    correctIndex: 1,
  },
  {
    category: "defi",
    question: "What does an LP token represent in a Uniswap v2 pool?",
    choices: [
      "Governance share of the protocol",
      "A claim on a share of the pool's assets",
      "Discounted swap fees",
      "Voting power on the token's market price",
    ],
    correctIndex: 1,
  },

  // ----- SECURITY -----
  {
    category: "security",
    question: "Which pattern mitigates reentrancy in Solidity?",
    choices: [
      "Pull payments only",
      "Checks-Effects-Interactions",
      "Inline assembly",
      "External calls first",
    ],
    correctIndex: 1,
  },
  {
    category: "security",
    question: "Why is using tx.origin for authorization risky?",
    choices: [
      "It returns the wrong type",
      "It costs more gas",
      "Intermediate contracts can phish the original signer",
      "It is removed in modern Solidity",
    ],
    correctIndex: 2,
  },
  {
    category: "security",
    question: "What is the safest place for a user to keep their seed phrase?",
    choices: [
      "Email drafts",
      "A cloud-synced note",
      "Offline backup they control",
      "A public GitHub gist",
    ],
    correctIndex: 2,
  },
  {
    category: "security",
    question: "What is a key benefit of merkle-proof claim flows?",
    choices: [
      "They avoid revealing the full set onchain",
      "They eliminate gas costs entirely",
      "They are quantum-resistant",
      "They prevent any double-spend forever",
    ],
    correctIndex: 0,
  },
  {
    category: "security",
    question: "Which property of WebAuthn passkeys defends best against phishing?",
    choices: [
      "Long random username",
      "Credentials are bound to the relying party's origin",
      "Encrypted at rest in the browser",
      "Daily rotation",
    ],
    correctIndex: 1,
  },
];
