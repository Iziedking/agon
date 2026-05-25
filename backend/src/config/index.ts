import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/// Loads and validates all backend configuration in one place. Secrets come
/// from the environment; public contract addresses come from the committed
/// deployments file the contracts package writes.

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ARC_RPC_HTTP: z.string().url(),
  ARC_RPC_WS: z.string().url(),
  CHAIN_ID: z.coerce.number().int().positive(),
  START_BLOCK: z.coerce.bigint().nonnegative().default(0n),
  DEPLOYMENTS_FILE: z.string().default("../contracts/deployments/arc-testnet.json"),

  // Auth service
  JWT_SECRET: z.string().default("dev-insecure-secret-change-me"),
  AUTH_PORT: z.coerce.number().int().positive().default(8082),
  AUTH_DOMAIN: z.string().default("localhost:3000"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  X_CALLBACK_URL: z.string().optional(),

  // Coordinator service
  COORDINATOR_PRIVATE_KEY: z.string().optional(),
  WS_PORT: z.coerce.number().int().positive().default(8788),

  // Scout runner: master mnemonic for deriving per-agent hot wallets
  SCOUT_MASTER_MNEMONIC: z.string().optional(),
});

const addr = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "expected an address")
  .transform((v) => v as `0x${string}`);

const deploymentsSchema = z.object({
  network: z.string(),
  chainId: z.number(),
  contracts: z.object({
    PrizeEscrow: addr,
    AgentRegistry: addr,
    ContestEngine: addr,
    ChallengeArena: addr,
    SyndicateFactory: addr,
    PointsLedger: addr,
  }),
  external: z.object({
    USDC: addr,
    IdentityRegistry: addr,
    ReputationRegistry: addr,
    ValidationRegistry: addr,
  }),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid backend environment:\n${issues}`);
  }
  return parsed.data;
}

function loadDeployments(file: string) {
  const path = resolve(process.cwd(), file);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Could not read deployments file at ${path}. Set DEPLOYMENTS_FILE.`);
  }
  return deploymentsSchema.parse(JSON.parse(raw));
}

const env = loadEnv();
const deployments = loadDeployments(env.DEPLOYMENTS_FILE);

if (deployments.chainId !== env.CHAIN_ID) {
  throw new Error(
    `Chain mismatch: deployments file is chain ${deployments.chainId}, env CHAIN_ID is ${env.CHAIN_ID}.`,
  );
}

export const config = {
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  rpcHttp: env.ARC_RPC_HTTP,
  rpcWs: env.ARC_RPC_WS,
  chainId: env.CHAIN_ID,
  startBlock: env.START_BLOCK,
  contracts: deployments.contracts,
  external: deployments.external,
  auth: {
    jwtSecret: env.JWT_SECRET,
    port: env.AUTH_PORT,
    domain: env.AUTH_DOMAIN,
    appUrl: env.APP_URL,
    x: {
      clientId: env.X_CLIENT_ID,
      clientSecret: env.X_CLIENT_SECRET,
      callbackUrl: env.X_CALLBACK_URL,
    },
  },
  coordinator: {
    privateKey: env.COORDINATOR_PRIVATE_KEY,
    wsPort: env.WS_PORT,
  },
  scout: {
    masterMnemonic: env.SCOUT_MASTER_MNEMONIC,
  },
} as const;

export type AppConfig = typeof config;
