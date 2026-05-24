import { concat, encodeAbiParameters, keccak256 } from "viem";
import type { Hex } from "viem";

/// Builds payout merkle trees that verify against the contracts' MerkleProof
/// checks. Matches OpenZeppelin StandardMerkleTree: leaves are double-hashed
/// keccak256(abi.encode(address,uint256)), and internal nodes use commutative
/// (sorted-pair) hashing. Odd nodes are promoted unchanged, like the Solidity
/// MerkleHelper used in the contract tests.

export function payoutLeaf(account: `0x${string}`, amount: bigint): Hex {
  const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [account, amount]));
  return keccak256(inner);
}

function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

function nextLevel(nodes: Hex[]): Hex[] {
  const out: Hex[] = [];
  for (let i = 0; i < nodes.length; i += 2) {
    const a = nodes[i]!;
    const b = i + 1 < nodes.length ? nodes[i + 1] : undefined;
    out.push(b ? hashPair(a, b) : a);
  }
  return out;
}

export function merkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) throw new Error("merkleRoot: no leaves");
  let level = leaves;
  while (level.length > 1) level = nextLevel(level);
  return level[0]!;
}

export function merkleProof(leaves: Hex[], index: number): Hex[] {
  const proof: Hex[] = [];
  let idx = index;
  let level = leaves;
  while (level.length > 1) {
    if (idx % 2 === 0) {
      if (idx + 1 < level.length) proof.push(level[idx + 1]!);
    } else {
      proof.push(level[idx - 1]!);
    }
    idx = Math.floor(idx / 2);
    level = nextLevel(level);
  }
  return proof;
}
