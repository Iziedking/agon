import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import type { BindProfileRequest, PublishListingRequest, PublishListingVersionRequest } from "../http/api-types.ts";

export type AgonWriteKind = "bind_profile" | "publish_listing";
export type AgonWriteRequest = BindProfileRequest | PublishListingRequest | PublishListingVersionRequest;

export type AgonTransactionIntent = {
  chainId: string;
  to: `0x${string}`;
  data: `0x${string}`;
  functionName: "bindProfile" | "publish" | "publishVersion";
  args: string[];
};

export type StoredAgonWriteOperation = {
  operationId: string;
  actor: `0x${string}`;
  kind: AgonWriteKind;
  payloadHash: `0x${string}`;
  request: AgonWriteRequest;
  transaction: AgonTransactionIntent;
  state: "prepared" | "confirmed";
  txHash: `0x${string}` | null;
  resultReference: string | null;
  blockNumber: bigint | null;
  logIndex: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PrepareAgonOperation = Omit<
  StoredAgonWriteOperation,
  "operationId" | "state" | "txHash" | "resultReference" | "blockNumber" | "logIndex" | "createdAt" | "updatedAt"
>;

export type ConfirmAgonOperation = {
  operationId: string;
  actor: `0x${string}`;
  txHash: `0x${string}`;
  resultReference: string | null;
  blockNumber: bigint;
  logIndex: number;
};

export type AgonOperationStore = {
  prepare(input: PrepareAgonOperation): Promise<StoredAgonWriteOperation>;
  getByPayload(
    actor: string,
    kind: AgonWriteKind,
    payloadHash: string,
  ): Promise<StoredAgonWriteOperation | null>;
  getForActor(operationId: string, actor: string): Promise<StoredAgonWriteOperation | null>;
  confirm(input: ConfirmAgonOperation): Promise<StoredAgonWriteOperation>;
};

type OperationRow = QueryResultRow & {
  operation_id: string;
  actor_address: `0x${string}`;
  operation_kind: AgonWriteKind;
  payload_hash: `0x${string}`;
  request_payload: AgonWriteRequest;
  transaction_intent: AgonTransactionIntent;
  state: "prepared" | "confirmed";
  tx_hash: `0x${string}` | null;
  result_reference: string | null;
  block_number: string | null;
  log_index: number | null;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `operation_id, actor_address, operation_kind, payload_hash,
  request_payload, transaction_intent, state, tx_hash, result_reference,
  block_number, log_index, created_at, updated_at`;

function mapOperation(row: OperationRow): StoredAgonWriteOperation {
  return {
    operationId: row.operation_id,
    actor: row.actor_address,
    kind: row.operation_kind,
    payloadHash: row.payload_hash,
    request: row.request_payload,
    transaction: row.transaction_intent,
    state: row.state,
    txHash: row.tx_hash,
    resultReference: row.result_reference,
    blockNumber: row.block_number === null ? null : BigInt(row.block_number),
    logIndex: row.log_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresAgonOperationStore implements AgonOperationStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async prepare(input: PrepareAgonOperation): Promise<StoredAgonWriteOperation> {
    const operationId = randomUUID();
    await this.pool.query(
      `insert into agon_write_operations (
         operation_id, actor_address, operation_kind, payload_hash, request_payload, transaction_intent
       ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       on conflict (actor_address, operation_kind, payload_hash) do nothing`,
      [
        operationId,
        input.actor.toLowerCase(),
        input.kind,
        input.payloadHash.toLowerCase(),
        JSON.stringify(input.request),
        JSON.stringify(input.transaction),
      ],
    );
    const result = await this.pool.query<OperationRow>(
      `select ${COLUMNS} from agon_write_operations
       where actor_address = $1 and operation_kind = $2 and payload_hash = $3`,
      [input.actor.toLowerCase(), input.kind, input.payloadHash.toLowerCase()],
    );
    if (!result.rows[0]) throw new Error("prepared Agon operation could not be loaded");
    return mapOperation(result.rows[0]);
  }

  async getForActor(operationId: string, actor: string): Promise<StoredAgonWriteOperation | null> {
    const result = await this.pool.query<OperationRow>(
      `select ${COLUMNS} from agon_write_operations where operation_id = $1 and actor_address = $2`,
      [operationId, actor.toLowerCase()],
    );
    return result.rows[0] ? mapOperation(result.rows[0]) : null;
  }

  async getByPayload(
    actor: string,
    kind: AgonWriteKind,
    payloadHash: string,
  ): Promise<StoredAgonWriteOperation | null> {
    const result = await this.pool.query<OperationRow>(
      `select ${COLUMNS} from agon_write_operations
       where actor_address = $1 and operation_kind = $2 and payload_hash = $3`,
      [actor.toLowerCase(), kind, payloadHash.toLowerCase()],
    );
    return result.rows[0] ? mapOperation(result.rows[0]) : null;
  }

  async confirm(input: ConfirmAgonOperation): Promise<StoredAgonWriteOperation> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existingResult = await client.query<OperationRow>(
        `select ${COLUMNS} from agon_write_operations
         where operation_id = $1 and actor_address = $2 for update`,
        [input.operationId, input.actor.toLowerCase()],
      );
      const existing = existingResult.rows[0];
      if (!existing) throw new Error("Agon operation not found");
      if (existing.state === "confirmed") {
        if (existing.tx_hash !== input.txHash.toLowerCase()) {
          throw new Error("Agon operation is already confirmed by a different transaction");
        }
        await client.query("commit");
        return mapOperation(existing);
      }
      const updated = await client.query<OperationRow>(
        `update agon_write_operations set
           state = 'confirmed', tx_hash = $3, result_reference = $4,
           block_number = $5, log_index = $6, updated_at = now()
         where operation_id = $1 and actor_address = $2
         returning ${COLUMNS}`,
        [
          input.operationId,
          input.actor.toLowerCase(),
          input.txHash.toLowerCase(),
          input.resultReference,
          input.blockNumber.toString(),
          input.logIndex,
        ],
      );
      if (!updated.rows[0]) throw new Error("Agon operation confirmation failed");
      await client.query("commit");
      return mapOperation(updated.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
