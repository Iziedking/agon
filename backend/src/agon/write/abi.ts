import { parseAbi } from "viem";

export const agonProfileRegistryAbi = parseAbi([
  "function identityRegistry() view returns (address)",
  "function currentOwner(uint256 id) view returns (address)",
  "function bindProfile(uint256 id, string uri)",
  "event ProfileBound(uint256 indexed agentId, address indexed owner, string metadataURI)",
]);

export const agonServiceRegistryAbi = parseAbi([
  "function profiles() view returns (address)",
  "function getListing(uint256 id) view returns ((uint256 listingId,uint256 agentId,bytes32 serviceKey,bytes32 manifestHash,string manifestURI,uint256 category,uint8 paymentRail,uint256 version,address providerSnapshot,uint8 status,uint8 verification,uint64 createdAt,uint64 updatedAt))",
  "function publish(uint256 agentId, bytes32 serviceKey, bytes32 manifestHash, string uri, uint256 category, uint8 rail) returns (uint256 id)",
  "function publishVersion(uint256 id, bytes32 hash, string uri, uint8 rail)",
  "event ListingPublished(uint256 indexed listingId, uint256 indexed agentId, bytes32 indexed serviceKey, bytes32 manifestHash, string manifestURI, uint256 category, uint8 paymentRail, uint256 version, address providerSnapshot, uint8 status, uint8 verification)",
]);

