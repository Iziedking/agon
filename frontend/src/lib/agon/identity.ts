import { getAddress, parseAbi, parseEventLogs, type TransactionReceipt } from "viem";

export const AGON_IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;

export const agonIdentityRegistryAbi = parseAbi([
  "function register(string metadataURI) returns (uint256 tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function validateIdentityMetadataUri(value: string): boolean {
  const uri = value.trim();
  if (/^ipfs:\/\/.+/i.test(uri)) return true;
  try {
    const url = new URL(uri);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * A successful receipt is not enough to identify the new agent. Registration
 * is confirmed only when the ERC-721 mint Transfer event targets the signing
 * owner and includes a concrete token id.
 */
export function identityIdFromRegistrationReceipt(
  receipt: TransactionReceipt,
  owner: string,
): bigint {
  let normalizedOwner: string;
  try {
    normalizedOwner = getAddress(owner);
  } catch {
    throw new Error("identity registration owner is not a valid address");
  }

  const events = parseEventLogs({
    abi: agonIdentityRegistryAbi,
    logs: receipt.logs,
    eventName: "Transfer",
  });
  const mint = events.find((event) =>
    event.args.from.toLowerCase() === ZERO_ADDRESS &&
    event.args.to.toLowerCase() === normalizedOwner.toLowerCase(),
  );
  if (!mint) throw new Error("identity registration receipt has no matching ERC-8004 mint event");
  if (mint.args.tokenId === 0n) throw new Error("identity registration returned an invalid agent id");
  return mint.args.tokenId;
}
