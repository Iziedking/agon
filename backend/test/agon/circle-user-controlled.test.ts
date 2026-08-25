import assert from "node:assert/strict";
import test from "node:test";
import { createCircleUserControlledService, type CircleUserControlledClientLike } from "../../src/auth/circle-user-controlled.ts";

function fakeClient(): CircleUserControlledClientLike {
  return {
    async createDeviceTokenForEmailLogin() {
      return { data: { deviceToken: "device-token-123", deviceEncryptionKey: "encryption-key-123", otpToken: "otp-token-123" } } as never;
    },
    async getUserStatus() {
      return { data: { id: "circle-user-1" } } as never;
    },
    async createWallet() {
      return { data: { challengeId: "challenge-123" } } as never;
    },
    async listWallets() {
      return {
        data: {
          wallets: [{
            id: "wallet-1",
            address: "0xABCDEF0000000000000000000000000000000001",
            blockchain: "ARC-TESTNET",
            custodyType: "ENDUSER",
            userId: "circle-user-1",
            state: "LIVE",
          }],
        },
      } as never;
    },
    async createUserTransactionContractExecutionChallenge(input) {
      return { data: { challengeId: `challenge-${input.walletId}` } } as never;
    },
    async getUserChallenge() {
      return { data: { challenge: { id: "challenge-wallet-1", status: "COMPLETE", correlationIds: ["tx-1"] } } } as never;
    },
    async getTransaction() {
      return { data: { transaction: { id: "tx-1", state: "CONFIRMED", txHash: `0x${"a".repeat(64)}` } } } as never;
    },
  };
}

test("user-controlled service is fail-closed when the feature flag or API key is absent", async () => {
  const service = createCircleUserControlledService({
    enabled: true,
    baseUrl: "https://api.circle.com",
    blockchain: "ARC-TESTNET",
  });
  assert.equal(service.enabled, false);
  await assert.rejects(() => service.listWallets({ userToken: "user-token-123" }), /disabled/);
});

test("device token response is reduced to browser onboarding credentials", async () => {
  const service = createCircleUserControlledService({
    enabled: true,
    apiKey: "api-key-123",
    baseUrl: "https://api.circle.com",
    blockchain: "ARC-TESTNET",
    client: fakeClient(),
  });
  assert.deepEqual(await service.createDeviceToken({ deviceId: "device-id-123", email: "USER@example.com" }), {
    deviceToken: "device-token-123",
    deviceEncryptionKey: "encryption-key-123",
    otpToken: "otp-token-123",
  });
});

test("existing wallet is returned without creating a challenge", async () => {
  const client = fakeClient();
  let createCalls = 0;
  client.createWallet = async () => {
    createCalls += 1;
    return { data: { challengeId: "challenge-123" } } as never;
  };
  const service = createCircleUserControlledService({
    enabled: true,
    apiKey: "api-key-123",
    baseUrl: "https://api.circle.com",
    blockchain: "ARC-TESTNET",
    client,
  });
  const prepared = await service.prepareWallet({ userToken: "user-token-123" });
  assert.equal(prepared.challengeId, null);
  assert.equal(prepared.userId, "circle-user-1");
  assert.equal(prepared.wallets[0]?.address, "0xABCDEF0000000000000000000000000000000001");
  assert.equal(createCalls, 0);
});

test("wallet ownership lookup requires both the provider wallet id and address", async () => {
  const service = createCircleUserControlledService({
    enabled: true,
    apiKey: "api-key-123",
    baseUrl: "https://api.circle.com",
    blockchain: "ARC-TESTNET",
    client: fakeClient(),
  });
  const wallet = await service.findOwnedWallet({
    userToken: "user-token-123",
    walletId: "wallet-1",
    address: "0xabcdef0000000000000000000000000000000001",
  });
  assert.equal(wallet.userId, "circle-user-1");
  await assert.rejects(
    () => service.findOwnedWallet({ userToken: "user-token-123", walletId: "wallet-1", address: "0x0000000000000000000000000000000000000001" }),
    /ownership could not be verified/,
  );
});

test("contract execution challenge preserves exact calldata and uses Arc Testnet fee policy", async () => {
  const client = fakeClient();
  let received: unknown;
  client.createUserTransactionContractExecutionChallenge = async (input) => {
    received = input;
    return { data: { challengeId: "challenge-contract-123" } } as never;
  };
  const service = createCircleUserControlledService({
    enabled: true,
    apiKey: "api-key-123",
    baseUrl: "https://api.circle.com",
    blockchain: "ARC-TESTNET",
    client,
  });
  assert.deepEqual(
    await service.createContractExecutionChallenge({
      userToken: "user-token-123",
      walletId: "wallet-1",
      contractAddress: "0xABCDEF0000000000000000000000000000000001",
      callData: "0x1234",
      blockchain: "ARC-TESTNET",
      idempotencyKey: "12345678-1234-4234-8234-123456789012",
      refId: "agon-intent-1",
    }),
    { challengeId: "challenge-contract-123" },
  );
  assert.deepEqual(received, {
    userToken: "user-token-123",
    walletId: "wallet-1",
    contractAddress: "0xABCDEF0000000000000000000000000000000001",
    callData: "0x1234",
    blockchain: "ARC-TESTNET",
    idempotencyKey: "12345678-1234-4234-8234-123456789012",
    refId: "agon-intent-1",
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
});

test("contract status resolves the transaction correlated by Circle's challenge", async () => {
  const service = createCircleUserControlledService({
    enabled: true,
    apiKey: "api-key-123",
    baseUrl: "https://api.circle.com",
    blockchain: "ARC-TESTNET",
    client: fakeClient(),
  });
  assert.deepEqual(
    await service.getContractExecutionStatus({ userToken: "user-token-123", challengeId: "challenge-wallet-1" }),
    { state: "CONFIRMED", txHash: `0x${"a".repeat(64)}`, errorReason: null },
  );
});
