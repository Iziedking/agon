import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { reserveLpRun, readLpRun, lpDailyLimit } from "./lp-runs.ts";
import { database, closeDatabase } from "../server/store.ts";
import { handleBnb } from "../server/api.ts";
const local = process.argv.includes("--local-db");
test("real Postgres admission: race, idempotency, quotas, interruption and isolation", { skip: !local }, async () => {
  const base = "postgres://nock:nock@127.0.0.1:15432/nock";
  const admin = new Pool({ connectionString: base });
  const schema = `lp_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^lp_test_[a-f0-9]{32}$/);
  const oldUrl = process.env.BNB_DATABASE_URL; const oldLimit = process.env.BNB_LP_AGENT_DAILY_LIMIT;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(base); url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.BNB_DATABASE_URL = url.href; process.env.BNB_LP_AGENT_DAILY_LIMIT = "100";
  const input = { positionId: "37235", halfWidthSteps: 10, maxDeviationTicks: 100 };
  try {
    const id = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => reserveLpRun(97, id, input)));
    assert.equal(results.filter((r) => r.started).length, 1);
    await assert.rejects(reserveLpRun(97, id, { ...input, halfWidthSteps: 11 }), /different inputs/);
    await assert.rejects(readLpRun(56, id), /Testnet only/);
    await assert.rejects(reserveLpRun(5042002, randomUUID(), input), /Testnet only/);
    const racing = await Promise.allSettled(Array.from({ length: 5 }, () => reserveLpRun(97, randomUUID(), input)));
    assert.equal(racing.filter((r) => r.status === "fulfilled").length, 1);
    const db = await database();
    await db.query("UPDATE bnb_lp_agent_runs SET started_at=now()-interval '100 seconds'");
    assert.equal((await readLpRun(97, id)).status, "interrupted");
    const recovery = await reserveLpRun(97, randomUUID(), input); assert.equal(recovery.started, true);
    assert.equal((await readLpRun(97, id)).status, "failed");
    process.env.BNB_LP_AGENT_DAILY_LIMIT = "3";
    await assert.rejects(reserveLpRun(97, randomUUID(), input), /allowance/);
    process.env.BNB_LP_AGENT_DAILY_LIMIT = "0";
    await assert.rejects(reserveLpRun(97, randomUUID(), input), /paused/);
    assert.equal((await reserveLpRun(97, id, input)).started, false);
    process.env.BNB_LP_AGENT_DAILY_LIMIT = "garbage"; assert.equal(lpDailyLimit(), 0);
    process.env.BNB_LP_AGENT_DAILY_LIMIT = "100";
    await db.query("UPDATE bnb_lp_agent_runs SET status='failed',error='test completed',finished_at=now(),started_at=now()");
    for (let i = 0; i < 2; i++) {
      const next = await reserveLpRun(97, randomUUID(), input);
      await db.query("UPDATE bnb_lp_agent_runs SET status='failed',error='test completed',finished_at=now() WHERE id=$1", [next.run.id]);
    }
    await assert.rejects(reserveLpRun(97, randomUUID(), input), /busy/);
    const request = new Request("https://agon.example/api/bnb/56/providers/lp-guardian/runs", { method: "POST", headers: { origin: "https://agon.example", "content-type": "application/json" }, body: JSON.stringify({ runId: randomUUID(), input }) });
    assert.equal((await handleBnb(request, "56", ["providers", "lp-guardian", "runs"])).status, 409);
    const fakeReport = "{}";
    await db.query("UPDATE bnb_lp_agent_runs SET status='completed',report_json=$2,report_hash='wrong' WHERE id=$1", [id, fakeReport]);
    await assert.rejects(readLpRun(97, id), /integrity/);
  } finally {
    await closeDatabase();
    if (oldUrl === undefined) delete process.env.BNB_DATABASE_URL; else process.env.BNB_DATABASE_URL = oldUrl;
    if (oldLimit === undefined) delete process.env.BNB_LP_AGENT_DAILY_LIMIT; else process.env.BNB_LP_AGENT_DAILY_LIMIT = oldLimit;
    // Only the unique test schema created above is removed; app tables are untouched.
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
