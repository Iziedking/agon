import type { Pool, QueryResultRow } from "pg";
import type { PlaygroundRun, PlaygroundRunScope } from "./playground.ts";

export type PlaygroundRunState = "running" | "completed" | "failed";

export const PLAYGROUND_RUN_LEASE_SECONDS = 60;

export type PlaygroundRunStart = {
  runId: string;
  actorAddress: string | null;
  requestId: string;
  idempotencyKey: string | null;
  category: PlaygroundRun["task"]["category"];
  taskId: string;
  inputHash: `0x${string}`;
  input: unknown;
  scope: PlaygroundRunScope | null;
};

export type StoredPlaygroundRun = {
  runId: string;
  actorAddress: string | null;
  requestId: string;
  idempotencyKey: string | null;
  category: PlaygroundRun["task"]["category"];
  taskId: string;
  inputHash: `0x${string}`;
  input: unknown;
  scope: PlaygroundRunScope | null;
  state: PlaygroundRunState;
  result: PlaygroundRun | null;
  errorCode: string | null;
  createdAt: Date;
  leaseExpiresAt: Date;
  completedAt: Date | null;
};

export interface PlaygroundRunStore {
  beginRun(input: PlaygroundRunStart): Promise<{ run: StoredPlaygroundRun; replayed: boolean }>;
  completeRun(runId: string, result: PlaygroundRun): Promise<void>;
  failRun(runId: string, errorCode: string): Promise<void>;
  getRun(runId: string): Promise<StoredPlaygroundRun | null>;
}

export class PlaygroundRunConflictError extends Error {
  constructor() {
    super("playground idempotency key is bound to different evaluation inputs");
    this.name = "PlaygroundRunConflictError";
  }
}

type PlaygroundRunRow = QueryResultRow & {
  run_id: string;
  actor_address: string | null;
  request_id: string;
  idempotency_key: string | null;
  category: PlaygroundRun["task"]["category"];
  task_id: string;
  input_hash: string;
  input: unknown;
  scope: PlaygroundRunScope | null;
  state: PlaygroundRunState;
  result: PlaygroundRun | null;
  error_code: string | null;
  created_at: Date;
  lease_expires_at: Date;
  completed_at: Date | null;
};

function mapRun(row: PlaygroundRunRow): StoredPlaygroundRun {
  return {
    runId: row.run_id,
    actorAddress: row.actor_address,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    category: row.category,
    taskId: row.task_id,
    inputHash: row.input_hash as `0x${string}`,
    input: row.input,
    scope: row.scope,
    state: row.state,
    result: row.result,
    errorCode: row.error_code,
    createdAt: row.created_at,
    leaseExpiresAt: row.lease_expires_at,
    completedAt: row.completed_at,
  };
}

function matchesStart(run: StoredPlaygroundRun, input: PlaygroundRunStart): boolean {
  const storedScope = typeof run.scope === "string" ? JSON.parse(run.scope) as PlaygroundRunStart["scope"] : run.scope;
  const expectedScope = input.scope;
  return run.inputHash === input.inputHash
    && run.category === input.category
    && run.taskId === input.taskId
    && (storedScope?.listingReference ?? null) === (expectedScope?.listingReference ?? null)
    && (storedScope?.listingVersion ?? null) === (expectedScope?.listingVersion ?? null);
}

function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error(`${label} must be a UUID`);
}

function assertAddress(value: string | null): void {
  if (value !== null && !/^0x[0-9a-f]{40}$/.test(value)) throw new Error("actor address must be canonical lowercase hex");
}

export class PostgresPlaygroundRunStore implements PlaygroundRunStore {
  private readonly pool: Pool;
  private readonly leaseSeconds: number;

  constructor(pool: Pool, leaseSeconds = PLAYGROUND_RUN_LEASE_SECONDS) {
    this.pool = pool;
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1) throw new Error("playground lease must be a positive integer");
    this.leaseSeconds = leaseSeconds;
  }

  async beginRun(input: PlaygroundRunStart): Promise<{ run: StoredPlaygroundRun; replayed: boolean }> {
    assertUuid(input.runId, "run id");
    assertUuid(input.requestId, "request id");
    assertAddress(input.actorAddress);
    const result = await this.pool.query<PlaygroundRunRow>(
      `insert into agon_playground_runs (
         run_id, actor_address, request_id, idempotency_key, category, task_id,
         input_hash, input, scope, state, lease_expires_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'running', now() + ($10 * interval '1 second'))
       on conflict (actor_address, idempotency_key) where idempotency_key is not null
       do update set run_id = agon_playground_runs.run_id
       returning run_id, actor_address, request_id, idempotency_key, category, task_id,
         input_hash, input, scope, state, result, error_code, created_at, lease_expires_at, completed_at`,
      [
        input.runId,
        input.actorAddress,
        input.requestId,
        input.idempotencyKey,
        input.category,
        input.taskId,
        input.inputHash,
        JSON.stringify(input.input ?? null),
        JSON.stringify(input.scope),
        this.leaseSeconds,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("playground run could not be created");
    let run = mapRun(row);
    const replayed = row.run_id !== input.runId;
    if (replayed && !matchesStart(run, input)) throw new PlaygroundRunConflictError();
    if (replayed && run.state === "running" && run.leaseExpiresAt.getTime() <= Date.now()) {
      const expired = await this.pool.query<PlaygroundRunRow>(
        `update agon_playground_runs
         set state = 'failed', error_code = 'worker_timeout', completed_at = now(), lease_expires_at = now()
         where run_id = $1 and state = 'running' and lease_expires_at <= now()
         returning run_id, actor_address, request_id, idempotency_key, category, task_id,
           input_hash, input, scope, state, result, error_code, created_at, lease_expires_at, completed_at`,
        [run.runId],
      );
      if (expired.rows[0]) run = mapRun(expired.rows[0]);
    }
    return { run, replayed };
  }

  async completeRun(runId: string, result: PlaygroundRun): Promise<void> {
    assertUuid(runId, "run id");
    const updated = await this.pool.query(
      `update agon_playground_runs
       set state = 'completed', result = $2::jsonb, completed_at = now(), error_code = null, lease_expires_at = now()
       where run_id = $1 and state = 'running'`,
      [runId, JSON.stringify(result)],
    );
    if (updated.rowCount !== 1) throw new Error("playground run was not in a running state");
  }

  async failRun(runId: string, errorCode: string): Promise<void> {
    assertUuid(runId, "run id");
    await this.pool.query(
      `update agon_playground_runs
       set state = 'failed', error_code = $2, completed_at = now(), lease_expires_at = now()
       where run_id = $1 and state = 'running'`,
      [runId, errorCode.slice(0, 80)],
    );
  }

  async getRun(runId: string): Promise<StoredPlaygroundRun | null> {
    assertUuid(runId, "run id");
    const result = await this.pool.query<PlaygroundRunRow>(
      `select run_id, actor_address, request_id, idempotency_key, category, task_id,
         input_hash, input, scope, state, result, error_code, created_at,
         lease_expires_at, completed_at
       from agon_playground_runs where run_id = $1`,
      [runId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }
}

export class InMemoryPlaygroundRunStore implements PlaygroundRunStore {
  private readonly runs = new Map<string, StoredPlaygroundRun>();
  private readonly idempotency = new Map<string, string>();
  private readonly leaseMs: number;

  constructor(leaseSeconds = PLAYGROUND_RUN_LEASE_SECONDS) {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1) throw new Error("playground lease must be a positive integer");
    this.leaseMs = leaseSeconds * 1000;
  }

  async beginRun(input: PlaygroundRunStart): Promise<{ run: StoredPlaygroundRun; replayed: boolean }> {
    const key = input.actorAddress && input.idempotencyKey ? `${input.actorAddress}:${input.idempotencyKey}` : null;
    const existingId = key ? this.idempotency.get(key) : undefined;
    if (existingId) {
      const existing = this.runs.get(existingId);
      if (existing) {
        if (!matchesStart(existing, input)) throw new PlaygroundRunConflictError();
        if (existing.state === "running" && existing.leaseExpiresAt.getTime() <= Date.now()) {
          existing.state = "failed";
          existing.errorCode = "worker_timeout";
          existing.completedAt = new Date();
          existing.leaseExpiresAt = new Date();
        }
        return { run: existing, replayed: true };
      }
    }
    const run: StoredPlaygroundRun = {
      runId: input.runId,
      actorAddress: input.actorAddress,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      category: input.category,
      taskId: input.taskId,
      inputHash: input.inputHash,
      input: input.input,
      scope: input.scope,
      state: "running",
      result: null,
      errorCode: null,
      createdAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + this.leaseMs),
      completedAt: null,
    };
    this.runs.set(run.runId, run);
    if (key) this.idempotency.set(key, run.runId);
    return { run, replayed: false };
  }

  async completeRun(runId: string, result: PlaygroundRun): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.state !== "running") throw new Error("playground run was not in a running state");
    run.state = "completed";
    run.result = result;
    run.leaseExpiresAt = new Date();
    run.completedAt = new Date();
  }

  async failRun(runId: string, errorCode: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.state !== "running") return;
    run.state = "failed";
    run.errorCode = errorCode;
    run.leaseExpiresAt = new Date();
    run.completedAt = new Date();
  }

  async getRun(runId: string): Promise<StoredPlaygroundRun | null> {
    return this.runs.get(runId) ?? null;
  }
}

export type PlaygroundRateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export interface PlaygroundRateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<PlaygroundRateLimitResult>;
}

type RedisLike = { eval(script: string, numKeys: number, ...args: string[]): Promise<unknown> };

export class RedisPlaygroundRateLimiter implements PlaygroundRateLimiter {
  private readonly redis: RedisLike;

  constructor(redis: RedisLike) {
    this.redis = redis;
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<PlaygroundRateLimitResult> {
    const value = await this.redis.eval(
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count;",
      1,
      key,
      String(windowSeconds),
    );
    const count = Number(value);
    return {
      allowed: Number.isFinite(count) && count <= limit,
      retryAfterSeconds: windowSeconds,
    };
  }
}

export class InMemoryPlaygroundRateLimiter implements PlaygroundRateLimiter {
  private readonly windows = new Map<string, { count: number; expiresAt: number }>();

  async consume(key: string, limit: number, windowSeconds: number): Promise<PlaygroundRateLimitResult> {
    const now = Date.now();
    const existing = this.windows.get(key);
    const window = !existing || existing.expiresAt <= now
      ? { count: 0, expiresAt: now + windowSeconds * 1000 }
      : existing;
    window.count += 1;
    this.windows.set(key, window);
    return { allowed: window.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((window.expiresAt - now) / 1000)) };
  }
}
