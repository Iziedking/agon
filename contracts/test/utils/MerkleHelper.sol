// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Builds merkle roots and proofs for tests using the same commutative
///         (sorted-pair) hashing as OpenZeppelin's MerkleProof.verify, and the
///         same double-hashed leaf encoding the contracts use:
///         keccak256(bytes.concat(keccak256(abi.encode(account, amount)))).
///         Odd nodes are promoted unchanged to the next level, matching
///         merkletreejs with { sortPairs: true }.
library MerkleHelper {
    function leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function getRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        require(leaves.length > 0, "no leaves");
        while (leaves.length > 1) {
            leaves = _nextLevel(leaves);
        }
        return leaves[0];
    }

    function getProof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory proof) {
        require(index < leaves.length, "bad index");
        proof = new bytes32[](0);
        while (leaves.length > 1) {
            if (index % 2 == 0) {
                if (index + 1 < leaves.length) {
                    proof = _push(proof, leaves[index + 1]);
                }
            } else {
                proof = _push(proof, leaves[index - 1]);
            }
            index /= 2;
            leaves = _nextLevel(leaves);
        }
    }

    function _nextLevel(bytes32[] memory leaves) private pure returns (bytes32[] memory next) {
        uint256 n = (leaves.length + 1) / 2;
        next = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 l = 2 * i;
            uint256 r = l + 1;
            next[i] = r < leaves.length ? _hashPair(leaves[l], leaves[r]) : leaves[l];
        }
    }

    function _push(bytes32[] memory arr, bytes32 value) private pure returns (bytes32[] memory out) {
        out = new bytes32[](arr.length + 1);
        for (uint256 i = 0; i < arr.length; i++) {
            out[i] = arr[i];
        }
        out[arr.length] = value;
    }
}
