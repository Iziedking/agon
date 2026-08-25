import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, keccak256, zeroAddress } from "viem";

import {
  agonIdentityRegistryAbi,
  identityIdFromRegistrationReceipt,
  validateIdentityMetadataUri,
} from "./identity.ts";

const owner = "0x1111111111111111111111111111111111111111" as const;

test("accepts only permanent HTTPS or IPFS identity metadata", () => {
  assert.equal(validateIdentityMetadataUri("https://example.com/agent.json"), true);
  assert.equal(validateIdentityMetadataUri("ipfs://bafy-agent/metadata.json"), true);
  assert.equal(validateIdentityMetadataUri("http://example.com/agent.json"), false);
  assert.equal(validateIdentityMetadataUri("file:///tmp/agent.json"), false);
});

test("confirms the minted ERC-8004 id from the owner-matching Transfer event", () => {
  const tokenId = 42n;
  const topics = encodeEventTopics({
    abi: agonIdentityRegistryAbi,
    eventName: "Transfer",
    args: { from: zeroAddress, to: owner, tokenId },
  });
  const receipt = {
    logs: [{
      address: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      topics,
      data: "0x",
    }],
  } as never;
  assert.equal(identityIdFromRegistrationReceipt(receipt, owner), tokenId);
});

test("rejects a successful receipt without a matching mint", () => {
  const topics = encodeEventTopics({
    abi: agonIdentityRegistryAbi,
    eventName: "Transfer",
    args: { from: zeroAddress, to: "0x2222222222222222222222222222222222222222", tokenId: 42n },
  });
  const receipt = {
    logs: [{
      address: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      topics,
      data: "0x",
    }],
  } as never;
  assert.throws(() => identityIdFromRegistrationReceipt(receipt, owner), /no matching/);
});
