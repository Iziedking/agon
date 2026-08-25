import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { linkCircleUserControlledWallet, listWalletPrincipals } from "../../src/auth/wallet-principal-repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let database: AgonTestDatabase;

before(async () => {
  database = await createAgonTestDatabase("walletprincipal");
});

after(async () => {
  if (database) await database.close();
});

test("links a Circle user-controlled principal idempotently", async () => {
  const input = {
    operatorAddress: "0x1111111111111111111111111111111111111111",
    address: "0xABCDEF0000000000000000000000000000000001",
    providerUserId: "circle-user-1",
    providerWalletId: "circle-wallet-1",
    blockchain: "ARC-TESTNET",
  };
  const first = await linkCircleUserControlledWallet(input, database.pool);
  const second = await linkCircleUserControlledWallet(input, database.pool);
  assert.equal(first.address, "0xabcdef0000000000000000000000000000000001");
  assert.equal(second.providerWalletId, "circle-wallet-1");
  assert.equal((await listWalletPrincipals(input.operatorAddress, database.pool)).length, 1);
});

test("refuses a principal or provider wallet already owned by another operator", async () => {
  const base = {
    operatorAddress: "0x2222222222222222222222222222222222222222",
    address: "0xABCDEF0000000000000000000000000000000001",
    providerUserId: "circle-user-2",
    providerWalletId: "circle-wallet-2",
    blockchain: "ARC-TESTNET",
  };
  await assert.rejects(() => linkCircleUserControlledWallet(base, database.pool), /already linked/);
  await assert.rejects(
    () => linkCircleUserControlledWallet({ ...base, address: "0xABCDEF0000000000000000000000000000000002", providerWalletId: "circle-wallet-1" }, database.pool),
    /already linked/,
  );
});
