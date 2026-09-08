import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { closeDatabase, database } from "./store.ts";
import { recoverExpiredCommerceIntents } from "./commerce-intents.ts";

const local = process.argv.includes("--local-db");

test("commerce intent storage preserves version binding and one hash per wallet step", { skip: !local }, async () => {
  const base = "postgres://nock:nock@127.0.0.1:15432/nock";
  const admin = new Pool({ connectionString: base });
  const schema = `commerce_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^commerce_test_[a-f0-9]{32}$/);
  const oldUrl = process.env.BNB_DATABASE_URL;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(base); url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.BNB_DATABASE_URL = url.href;
  try {
    const db = await database();
    const snapshot = {
      items: [], total: 0, nextOffset: null,
      checkedAt: new Date().toISOString(), source: "8004scan", warnings: [],
    };
    await db.query(`INSERT INTO bnb_catalog_snapshots(chain_id,page_offset,page_json)
      VALUES(97,0,$1)`, [JSON.stringify(snapshot)]);
    const savedSnapshot = await db.query<{ page_json: string }>(
      "SELECT page_json FROM bnb_catalog_snapshots WHERE chain_id=97 AND page_offset=0");
    assert.deepEqual(JSON.parse(savedSnapshot.rows[0].page_json), snapshot);

    const id = randomUUID();
    const values = [id, "0x1111111111111111111111111111111111111111", "42",
      "0x2222222222222222222222222222222222222222", "agon-lp-guardian/1.0.0",
      `sha256:${"ab".repeat(32)}`, "{}", "request", "17", "0x3333333333333333333333333333333333333333"];
    await db.query(`INSERT INTO bnb_commerce_intents
      (id,chain_id,buyer_address,agent_id,provider_address,service_version,registration_hash,input_json,request_hash,amount_raw,token_address,state)
      VALUES($1,97,$2,$3,$4,$5,$6,$7,$8,$9,$10,'quoting')`, values);
    const saved = await db.query<{ registration_hash: string }>("SELECT registration_hash FROM bnb_commerce_intents WHERE id=$1", [id]);
    assert.equal(saved.rows[0].registration_hash, values[5]);
    const firstHash = `0x${"11".repeat(32)}`; const secondHash = `0x${"22".repeat(32)}`;
    await db.query("INSERT INTO bnb_commerce_transactions(tx_hash,intent_id,step,status) VALUES($1,$2,'create','submitted')", [firstHash, id]);
    await assert.rejects(db.query("INSERT INTO bnb_commerce_transactions(tx_hash,intent_id,step,status) VALUES($1,$2,'create','submitted')", [secondHash, id]),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23505"));
    await db.query("UPDATE bnb_commerce_transactions SET status='reverted' WHERE tx_hash=$1", [firstHash]);
    await db.query(`INSERT INTO bnb_commerce_transactions(tx_hash,intent_id,step,status)
      VALUES($1,$2,'create','submitted') ON CONFLICT(intent_id,step) DO UPDATE
      SET tx_hash=EXCLUDED.tx_hash,status='submitted',block_number=NULL,block_hash=NULL,confirmations=0,checked_at=now()
      WHERE bnb_commerce_transactions.status='reverted'`, [secondHash, id]);
    const retried = await db.query<{ tx_hash: string; status: string }>("SELECT tx_hash,status FROM bnb_commerce_transactions WHERE intent_id=$1 AND step='create'", [id]);
    assert.deepEqual(retried.rows[0], { tx_hash: secondHash, status: "submitted" });

    const abandonedId = randomUUID();
    await db.query(`INSERT INTO bnb_commerce_intents
      (id,chain_id,buyer_address,agent_id,provider_address,service_version,registration_hash,input_json,request_hash,amount_raw,token_address,state,updated_at)
      VALUES($1,97,$2,'42',$3,'agon-lp-guardian/1.0.0',$4,'{}','abandoned','17',$5,'quoting',now()-interval '11 minutes')`,
      [abandonedId, values[1], values[3], values[5], values[9]]);
    await recoverExpiredCommerceIntents(values[1]);
    const abandoned = await db.query<{ state: string; last_error: string }>("SELECT state,last_error FROM bnb_commerce_intents WHERE id=$1", [abandonedId]);
    assert.deepEqual(abandoned.rows[0], { state: "expired", last_error: "request_expired" });
  } finally {
    await closeDatabase();
    if (oldUrl === undefined) delete process.env.BNB_DATABASE_URL; else process.env.BNB_DATABASE_URL = oldUrl;
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
