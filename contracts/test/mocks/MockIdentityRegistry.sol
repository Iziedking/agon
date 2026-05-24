// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Test double for the Arc ERC-8004 IdentityRegistry. `register` mints
///         a new identity NFT to the caller and returns the tokenId. Because it
///         uses `_safeMint`, it exercises both tokenId capture paths in
///         AgentRegistry: the return value and the onERC721Received fallback.
contract MockIdentityRegistry is ERC721 {
    uint256 public nextId = 1;
    mapping(uint256 => string) private _uri;

    constructor() ERC721("Arc Identity", "AID") { }

    function register(string calldata metadataURI) external returns (uint256 tokenId) {
        tokenId = nextId++;
        _uri[tokenId] = metadataURI;
        _safeMint(msg.sender, tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        return _uri[tokenId];
    }
}
