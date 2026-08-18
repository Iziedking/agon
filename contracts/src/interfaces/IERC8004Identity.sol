// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC8004Identity {
    function ownerOf(uint256 tokenId) external view returns (address);
}
