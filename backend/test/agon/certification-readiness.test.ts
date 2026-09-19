import assert from "node:assert/strict";
import test from "node:test";

import {
  AGON_CERTIFICATION_JOBS_REGCLASS,
  isAgonCertificationSchemaReady,
} from "../../src/agon/certification-readiness.ts";

test("checks the dedicated Agon schema used by production migrations", async () => {
  let query = "";
  const ready = await isAgonCertificationSchemaReady({
    query: async (text: string) => {
      query = text;
      return { rows: [{ available: true }] };
    },
  });

  assert.equal(AGON_CERTIFICATION_JOBS_REGCLASS, "agon.agon_certification_jobs");
  assert.match(query, /to_regclass\('agon\.agon_certification_jobs'\)/);
  assert.equal(ready, true);
});

test("fails closed when the schema is missing or the database is unavailable", async () => {
  const missing = await isAgonCertificationSchemaReady({
    query: async () => ({ rows: [{ available: false }] }),
  });
  const unavailable = await isAgonCertificationSchemaReady({
    query: async () => { throw new Error("database unavailable"); },
  });

  assert.equal(missing, false);
  assert.equal(unavailable, false);
});
