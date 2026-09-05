import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { claimDelivery } from "./lp-delivery.ts";
import { closeDatabase, database } from "./store.ts";

const local = process.argv.includes("--local-db");
const base = "postgres://nock:nock@127.0.0.1:15432/nock";
const provider = "0x1111111111111111111111111111111111111111";
const agentId = "2114";

test("delivery claims are serialized, recover stale work, and stop at the retry ceiling", { skip: !local }, async () => {
  const admin = new Pool({ connectionString: base });
  const schema = `lp_delivery_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const previousUrl = process.env.BNB_DATABASE_URL;
  process.env.BNB_DATABASE_URL = url.href;
  const intentId = randomUUID();
  try {
    const db = await database();
    await db.query(`INSERT INTO bnb_commerce_intents
      (id,chain_id,buyer_address,agent_id,provider_address,service_version,registration_hash,input_json,request_hash,amount_raw,token_address,state,job_id)
      VALUES($1,97,$2,$3,$4,$5,$6,$7,$8,$9,$10,'funded',$11)`, [
      intentId, "0x2222222222222222222222222222222222222222", agentId, provider,
      "agon-lp-guardian/1.0.0", `sha256:${"ab".repeat(32)}`,
      JSON.stringify({ positionId: "1", halfWidthSteps: 10, maxDeviationTicks: 100 }),
      `sha256:${"cd".repeat(32)}`, "17", "0x3333333333333333333333333333333333333333", "7",
    ]);

    const claims = await Promise.all([
      claimDelivery("7", provider, agentId),
      claimDelivery("7", provider, agentId),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    let row = await db.query<{ status: string; attempt_count: number }>("SELECT status,attempt_count FROM bnb_commerce_deliveries WHERE job_id='7'");
    assert.deepEqual(row.rows[0], { status: "working", attempt_count: 1 });

    await db.query("UPDATE bnb_commerce_deliveries SET updated_at=now()-interval '11 minutes' WHERE job_id='7'");
    const staleRecovery = await claimDelivery("7", provider, agentId);
    assert.equal(staleRecovery?.attempt_count, 2);

    await db.query("UPDATE bnb_commerce_deliveries SET status='failed',attempt_count=19 WHERE job_id='7'");
    const finalRetry = await claimDelivery("7", provider, agentId);
    assert.equal(finalRetry?.attempt_count, 20);
    await db.query("UPDATE bnb_commerce_deliveries SET status='failed' WHERE job_id='7'");
    assert.equal(await claimDelivery("7", provider, agentId), null);
    row = await db.query<{ status: string; attempt_count: number }>("SELECT status,attempt_count FROM bnb_commerce_deliveries WHERE job_id='7'");
    assert.deepEqual(row.rows[0], { status: "failed", attempt_count: 20 });
  } finally {
    await closeDatabase();
    if (previousUrl === undefined) delete process.env.BNB_DATABASE_URL; else process.env.BNB_DATABASE_URL = previousUrl;
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
