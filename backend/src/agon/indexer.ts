import type { AbiEvent, Log } from "viem";
import { parseAbi } from "viem";

import { publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { pool } from "../db/pool.js";
import { AgonProjector, type AgonChainEvent, type AgonProjectableEvent } from "./store/projector.ts";
import { PostgresAgonRepository } from "./store/repository.ts";
import { PostgresPlaygroundRunStore } from "./playground-store.ts";
import { createHttpPlaygroundProviderRunner } from "./playground-provider.ts";
import { agonCertificationWorkerLoop } from "./certification-worker.ts";

const profileEvents = parseAbi([
  "event ProfileBound(uint256 indexed agentId,address indexed owner,string metadataURI)",
  "event ProfileMetadataUpdated(uint256 indexed agentId,address indexed owner,string metadataURI)",
  "event ProfileStatusChanged(uint256 indexed agentId,address indexed actor,uint8 status,bytes32 reasonHash)",
  "event OwnershipSynced(uint256 indexed agentId,address indexed previousOwner,address indexed newOwner)",
]);

const serviceEvents = parseAbi([
  "event ListingPublished(uint256 indexed listingId,uint256 indexed agentId,bytes32 indexed serviceKey,bytes32 manifestHash,string manifestURI,uint256 category,uint8 paymentRail,uint256 version,address providerSnapshot,uint8 status,uint8 verification)",
  "event ListingVersionPublished(uint256 indexed listingId,uint256 indexed version,bytes32 indexed manifestHash,string manifestURI,uint8 paymentRail,address providerSnapshot)",
  "event ListingStatusChanged(uint256 indexed listingId,address indexed providerSnapshot,uint8 status)",
  "event ListingVerificationChanged(uint256 indexed listingId,address indexed verifier,uint8 verification)",
]);

type DecodedAgonLog = Log<bigint, number, false> & {
  eventName: string;
  args: Record<string, unknown>;
};

const chainId = BigInt(config.chainId);
const profileRegistry = config.agon.deployment?.contracts.AgonProfileRegistry;
const serviceRegistry = config.agon.deployment?.contracts.AgonServiceRegistry;
const identityRegistry = config.agon.deployment?.external.IdentityRegistry.address;
const repository = new PostgresAgonRepository(pool);
const projector = new AgonProjector(repository);
const certificationPlaygroundStore = new PostgresPlaygroundRunStore(pool);
const certificationProviderRunner = createHttpPlaygroundProviderRunner(config.agon.playground.providerEndpoints);

const DEFAULT_BATCH_BLOCKS = 500n;
const MAX_BATCH_BLOCKS = 5_000n;
const POLL_INTERVAL_MS = 3_000;
const ONCE = process.env.INDEXER_ONCE === "1";
let certificationWorkerStarted = false;

function readBatchBlocks(raw: string | undefined): bigint {
  if (!raw?.trim()) return DEFAULT_BATCH_BLOCKS;
  if (!/^\d+$/.test(raw.trim())) throw new Error("INDEXER_BATCH_BLOCKS must be a positive integer");
  const value = BigInt(raw.trim());
  if (value < 1n || value > MAX_BATCH_BLOCKS) {
    throw new Error(`INDEXER_BATCH_BLOCKS must be between 1 and ${MAX_BATCH_BLOCKS}`);
  }
  return value;
}

const BATCH_BLOCKS = readBatchBlocks(process.env.INDEXER_BATCH_BLOCKS);

function enumValue(value: unknown, values: readonly string[], name: string): string {
  const index = Number(value);
  const result = values[index];
  if (!result) throw new Error(`unknown ${name} enum value ${String(value)}`);
  return result;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`missing ${name}`);
  return value;
}

function asBigInt(value: unknown, name: string): bigint {
  if (typeof value !== "bigint") throw new Error(`missing ${name}`);
  return value;
}

function asAddress(value: unknown, name: string): string {
  return asString(value, name);
}

function normalizeEvent(log: DecodedAgonLog): AgonProjectableEvent {
  const args = log.args;
  switch (log.eventName) {
    case "ProfileBound":
      return {
        name: "ProfileBound",
        args: {
          agentId: asBigInt(args.agentId, "agentId"),
          owner: asAddress(args.owner, "owner"),
          metadataUri: asString(args.metadataURI, "metadataURI"),
        },
      };
    case "ProfileMetadataUpdated":
      return {
        name: "ProfileMetadataUpdated",
        args: {
          agentId: asBigInt(args.agentId, "agentId"),
          owner: asAddress(args.owner, "owner"),
          metadataUri: asString(args.metadataURI, "metadataURI"),
        },
      };
    case "ProfileStatusChanged":
      return {
        name: "ProfileStatusChanged",
        args: {
          agentId: asBigInt(args.agentId, "agentId"),
          actor: asAddress(args.actor, "actor"),
          status: enumValue(args.status, ["Active", "Suspended", "Archived"], "profile status") as
            | "Active"
            | "Suspended"
            | "Archived",
          reason: asString(args.reasonHash, "reasonHash"),
        },
      };
    case "OwnershipSynced":
      return {
        name: "OwnershipSynced",
        args: {
          agentId: asBigInt(args.agentId, "agentId"),
          previousOwner: asAddress(args.previousOwner, "previousOwner"),
          newOwner: asAddress(args.newOwner, "newOwner"),
        },
      };
    case "ListingPublished":
      return {
        name: "ListingPublished",
        args: {
          listingId: asBigInt(args.listingId, "listingId"),
          agentId: asBigInt(args.agentId, "agentId"),
          serviceKey: asString(args.serviceKey, "serviceKey"),
          manifestHash: asString(args.manifestHash, "manifestHash"),
          manifestUri: asString(args.manifestURI, "manifestURI"),
          category: asBigInt(args.category, "category"),
          paymentRail: enumValue(args.paymentRail, ["X402", "Escrow"], "payment rail") as "X402" | "Escrow",
          version: asBigInt(args.version, "version"),
          providerSnapshot: asAddress(args.providerSnapshot, "providerSnapshot"),
          status: enumValue(args.status, ["Listed", "Suspended", "Delisted"], "listing status") as
            | "Listed"
            | "Suspended"
            | "Delisted",
          verification: enumValue(
            args.verification,
            ["Unverified", "Pending", "Verified", "Expired", "Suspended", "Revoked"],
            "verification",
          ) as "Unverified" | "Pending" | "Verified" | "Expired" | "Suspended" | "Revoked",
        },
      };
    case "ListingVersionPublished":
      return {
        name: "ListingVersionPublished",
        args: {
          listingId: asBigInt(args.listingId, "listingId"),
          version: asBigInt(args.version, "version"),
          manifestHash: asString(args.manifestHash, "manifestHash"),
          manifestUri: asString(args.manifestURI, "manifestURI"),
          paymentRail: enumValue(args.paymentRail, ["X402", "Escrow"], "payment rail") as "X402" | "Escrow",
          providerSnapshot: asAddress(args.providerSnapshot, "providerSnapshot"),
        },
      };
    case "ListingStatusChanged":
      return {
        name: "ListingStatusChanged",
        args: {
          listingId: asBigInt(args.listingId, "listingId"),
          providerSnapshot: asAddress(args.providerSnapshot, "providerSnapshot"),
          status: enumValue(args.status, ["Listed", "Suspended", "Delisted"], "listing status") as
            | "Listed"
            | "Suspended"
            | "Delisted",
        },
      };
    case "ListingVerificationChanged":
      return {
        name: "ListingVerificationChanged",
        args: {
          listingId: asBigInt(args.listingId, "listingId"),
          verifier: asAddress(args.verifier, "verifier"),
          verification: enumValue(
            args.verification,
            ["Unverified", "Pending", "Verified", "Expired", "Suspended", "Revoked"],
            "verification",
          ) as "Unverified" | "Pending" | "Verified" | "Expired" | "Suspended" | "Revoked",
        },
      };
    default:
      throw new Error(`unsupported Agon event ${log.eventName}`);
  }
}

async function blockDetails(logs: readonly DecodedAgonLog[]): Promise<Map<bigint, { hash: string; timestamp: Date }>> {
  const numbers = [...new Set(logs.map((log) => log.blockNumber))];
  const blocks = await Promise.all(numbers.map((blockNumber) => publicClient.getBlock({ blockNumber })));
  return new Map(
    blocks.map((block) => [
      block.number,
      { hash: block.hash, timestamp: new Date(Number(block.timestamp) * 1000) },
    ]),
  );
}

async function getCursor(streamName: string, contractAddress: string, startBlock: bigint): Promise<bigint> {
  const cursor = await repository.getIndexerCursor({ streamName, chainId, contractAddress });
  return cursor?.lastBlock ?? (startBlock > 0n ? startBlock - 1n : 0n);
}

async function indexAgonRange(
  streamName: "agon-profile" | "agon-service",
  contractAddress: `0x${string}`,
  events: readonly AbiEvent[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<number> {
  const logs = (await publicClient.getLogs({ address: contractAddress, events, fromBlock, toBlock })) as DecodedAgonLog[];
  const details = await blockDetails(logs);
  const mapped: AgonChainEvent[] = logs.map((log) => {
    const detail = details.get(log.blockNumber);
    if (!detail || !log.blockHash || !log.transactionHash || log.logIndex === undefined) {
      throw new Error("Agon event is missing chain metadata");
    }
    return {
      chainId,
      contractAddress,
      identityRegistry: streamName === "agon-profile" ? identityRegistry : undefined,
      blockNumber: log.blockNumber,
      blockHash: detail.hash,
      blockTimestamp: detail.timestamp,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      event: normalizeEvent(log),
    };
  });
  const cursorBlock = await publicClient.getBlock({ blockNumber: toBlock });
  const result = await projector.projectBatch({
    streamName,
    chainId,
    contractAddress,
    toBlock,
    toBlockHash: cursorBlock.hash,
    events: mapped,
  });
  if (result.inserted > 0 || result.quarantined > 0) {
    console.log(`${streamName}: blocks ${fromBlock}-${toBlock}, inserted=${result.inserted}, quarantined=${result.quarantined}`);
  }
  return logs.length;
}

async function runStream(
  streamName: "agon-profile" | "agon-service",
  contractAddress: `0x${string}`,
  events: readonly AbiEvent[],
  startBlock: bigint,
  head: bigint,
): Promise<void> {
  let last = await getCursor(streamName, contractAddress, startBlock);
  while (last < head) {
    const from = last + 1n;
    const to = from + BATCH_BLOCKS - 1n > head ? head : from + BATCH_BLOCKS - 1n;
    await indexAgonRange(streamName, contractAddress, events, from, to);
    last = to;
  }
}

export async function indexAgonOnce(head: bigint): Promise<{ profiles: number; services: number }> {
  if (!profileRegistry || !serviceRegistry || !identityRegistry) {
    throw new Error("Agon deployment is required for Agon indexing");
  }
  const startBlock = config.agon.indexerStartBlock;
  const before = await Promise.all([
    repository.getIndexerCursor({ streamName: "agon-profile", chainId, contractAddress: profileRegistry }),
    repository.getIndexerCursor({ streamName: "agon-service", chainId, contractAddress: serviceRegistry }),
  ]);
  await runStream("agon-profile", profileRegistry, profileEvents, startBlock, head);
  await runStream("agon-service", serviceRegistry, serviceEvents, startBlock, head);
  const after = await Promise.all([
    repository.getIndexerCursor({ streamName: "agon-profile", chainId, contractAddress: profileRegistry }),
    repository.getIndexerCursor({ streamName: "agon-service", chainId, contractAddress: serviceRegistry }),
  ]);
  return {
    profiles: Number((after[0]?.lastBlock ?? before[0]?.lastBlock ?? startBlock) - (before[0]?.lastBlock ?? startBlock - 1n)),
    services: Number((after[1]?.lastBlock ?? before[1]?.lastBlock ?? startBlock) - (before[1]?.lastBlock ?? startBlock - 1n)),
  };
}

export async function agonIndexerLoop(currentHead: () => Promise<bigint>): Promise<void> {
  if (!profileRegistry || !serviceRegistry || !identityRegistry) {
    console.log("agon indexer disabled: canonical deployment is unavailable");
    return;
  }
  if (config.agon.certification.workerEnabled && !ONCE && !certificationWorkerStarted) {
    certificationWorkerStarted = true;
    void agonCertificationWorkerLoop({
      repository,
      playgroundStore: certificationPlaygroundStore,
      providerRunner: certificationProviderRunner,
    }).catch((error) => {
      console.error("agon certification worker stopped:", error instanceof Error ? error.message : error);
    });
    console.log("agon certification worker enabled");
  }
  let failures = 0;
  for (;;) {
    try {
      const head = await currentHead();
      await indexAgonOnce(head);
      failures = 0;
      if (ONCE) return;
    } catch (error) {
      if (ONCE) throw error;
      failures += 1;
      const wait = Math.min(120_000, 5_000 * 2 ** Math.min(failures - 1, 5));
      console.error(`agon indexer error (failure ${failures}, retry in ${wait}ms):`, error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
