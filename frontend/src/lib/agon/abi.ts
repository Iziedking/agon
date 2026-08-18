import { parseAbi } from "viem";

export const AGON_PROFILE_REGISTRY = "0xE0c7A2545C2f4eE6d2bD797B6f2742c73E640574" as const;
export const AGON_SERVICE_REGISTRY = "0x2144C156B0a4581da2D046C2E41AC41C6C3938CB" as const;

export const agonProfileRegistryAbi = parseAbi([
  "function bindProfile(uint256 id, string uri)",
]);

export const agonServiceRegistryAbi = parseAbi([
  "function publish(uint256 agentId, bytes32 serviceKey, bytes32 manifestHash, string uri, uint256 category, uint8 rail) returns (uint256 id)",
]);

