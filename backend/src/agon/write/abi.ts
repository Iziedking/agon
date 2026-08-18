import { parseAbi } from "viem";

export const agonProfileRegistryAbi = parseAbi([
  "function identityRegistry() view returns (address)",
  "function currentOwner(uint256 id) view returns (address)",
  "function bindProfile(uint256 id, string uri)",
  "event ProfileBound(uint256 indexed agentId, address indexed owner, string metadataURI)",
]);

export const agonServiceRegistryAbi = parseAbi([
  "function profiles() view returns (address)",
  "function publish(uint256 agentId, bytes32 serviceKey, bytes32 manifestHash, string uri, uint256 category, uint8 rail) returns (uint256 id)",
  "event ListingPublished(uint256 indexed listingId, uint256 indexed agentId, bytes32 indexed serviceKey, bytes32 manifestHash, string manifestURI, uint256 category, uint8 paymentRail, uint256 version, address providerSnapshot, uint8 status, uint8 verification)",
]);

