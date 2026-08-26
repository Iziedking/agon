import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, keccak256, zeroAddress } from "viem";

import {
  agonIdentityRegistryAbi,
  identityIdFromRegistrationReceipt,
  resolveIdentityActions,
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

test("moves a newly created identity from create to bind without allowing a duplicate mint", () => {
  const ready = resolveIdentityActions({
    isSignedIn: true,
    agentId: "42",
    metadataUri: "https://nock.lat/agon/v1/agent",
    creating: false,
    binding: false,
    bound: false,
    profileWritesUnavailable: false,
  });

  assert.equal(ready.canCreate, false);
  assert.equal(ready.createLabel, "IDENTITY CREATED");
  assert.equal(ready.canBind, true);
  assert.equal(ready.bindReason, null);
});

test("explains why bind is unavailable after creation", () => {
  const blocked = resolveIdentityActions({
    isSignedIn: true,
    agentId: "42",
    metadataUri: "https://nock.lat/agon/v1/agent",
    creating: false,
    binding: false,
    bound: false,
    profileWritesUnavailable: true,
  });

  assert.equal(blocked.canCreate, false);
  assert.equal(blocked.canBind, false);
  assert.match(blocked.bindReason ?? "", /temporarily paused/i);
});

test("disables binding after the confirmed profile proof is recorded", () => {
  const bound = resolveIdentityActions({
    isSignedIn: true,
    agentId: "42",
    metadataUri: "https://nock.lat/agon/v1/agent",
    creating: false,
    binding: false,
    bound: true,
    profileWritesUnavailable: false,
  });

  assert.equal(bound.canBind, false);
  assert.equal(bound.bindLabel, "IDENTITY BOUND");
  assert.match(bound.bindReason ?? "", /already bound/i);
});
