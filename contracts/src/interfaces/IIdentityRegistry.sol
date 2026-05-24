// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal interface for the Arc testnet ERC-8004 IdentityRegistry
///         deployed at `0x8004A818BFB912233c491871b3d84c89A494BD9e`.
/// @dev    The Arc Docs example reads `tokenId` from a `Transfer` event after
///         the call rather than from a return value. We declare it as
///         `returns (uint256)` here for the on-chain happy path, but
///         AgentRegistry captures tokenId defensively via low-level call +
///         onERC721Received fallback so it works whether or not the deployed
///         contract returns it.
interface IIdentityRegistry {
    function register(string calldata metadataURI) external returns (uint256 tokenId);

    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function balanceOf(address owner) external view returns (uint256);

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
}
