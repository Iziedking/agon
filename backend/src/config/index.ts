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
  ADMIN_TOKEN: z.string().optional(), // gates GET /admin/events; unset = read endpoint disabled
  AUTH_PORT: z.coerce.number().int().positive().default(8082),
  AUTH_DOMAIN: z.string().default("localhost:3000"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  X_CALLBACK_URL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_CALLBACK_URL: z.string().optional(),

  // Circle Developer-Controlled Wallets. Used to back ArcRun email logins so
  // operators can ENTER, JOIN, and CLAIM without holding their own keys. The
  // entity secret is registered once via scripts/circle-bootstrap.ts; the
  // wallet set id is written back to the env after that run.
  CIRCLE_API_KEY: z.string().optional(),
  CIRCLE_ENTITY_SECRET: z.string().optional(),
  CIRCLE_WALLET_SET_ID: z.string().optional(),
  CIRCLE_BLOCKCHAIN: z.string().default("ARC-TESTNET"),
  // When true, every newly minted Circle wallet is auto-seeded with USDC
  // from Circle's testnet faucet. Off for mainnet.
  CIRCLE_AUTO_SEED_USDC: z.coerce.boolean().default(true),

  // WebAuthn (passkey) configuration. RP_ID is the registrable domain the
  // passkey is bound to (no port, no protocol). ORIGIN must include the
  // protocol and port. For local dev RP_ID="localhost" and
  // ORIGIN="http://localhost:3000". For prod, RP_ID="arcrun.app" and
  // ORIGIN="https://arcrun.app".
  WEBAUTHN_RP_NAME: z.string().default("ArcRun"),
  WEBAUTHN_RP_ID: z.string().default("localhost"),
  WEBAUTHN_ORIGIN: z.string().default("http://localhost:3000"),

  // Anthropic. Empty key disables real LLM runners; the coordinator falls
  // back to the synthetic tier-curve simulation so dev environments don't
  // require a paid API key. LLM_DAILY_KILL_USD is a hard daily ceiling on
  // LLM spend; when exceeded, runners stop calling Anthropic mid-round and
  // surface a clear error.
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_DAILY_KILL_USD: z.coerce.number().nonnegative().default(5),
  // Default LLM model used by every LLM-enabled tier. Tier 0/1 don't call
  // the LLM at all; tier 2 and up share this model. Default Haiku 4.5 to
  // keep testnet cost predictable. Override per the marketing tier curve
  // (1 / 2 / 4 / 8 / 16) by setting LLM_MODEL_TIER4 to a smarter brain
  // for mainnet, where tier 4 is the absolute top of the food chain.
  LLM_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  // Optional override applied ONLY to tier 4 agents. When set, tier 4 calls
  // use this model while tiers 2 and 3 stay on LLM_MODEL. Designed for
  // mainnet where the platform sells tier 4 as the best agent on Arc;
  // typical values are claude-sonnet-4-6 or claude-opus-4-7. Leave unset on
  // testnet so the demo stays cheap.
  LLM_MODEL_TIER4: z.string().optional(),
  // Testing safety belt. When true:
  //  - web_search tool is stripped from every tier (avoids $0.01/search)
  //  - max_tokens is clamped to 200 regardless of POWER stat
  //  - retries are disabled
  // Use during smoke runs so the cost ceiling stays predictable.
  LLM_TESTING: z.coerce.boolean().default(false),

  // Agent training. Cost to go from level N to N+1 is (N+1) × 50 Cycles and
  // (N+1) × this many real seconds. Default 1800 = 30 minutes per level base
  // (so level 5 takes 2.5h). Set to 30 in the demo environment so a judge
  // can watch a training cycle finish during the walkthrough.
  TRAINING_BASE_SECONDS_PER_LEVEL: z.coerce.number().int().positive().default(1800),

  // Coordinator service
  COORDINATOR_PRIVATE_KEY: z.string().optional(),
  WS_PORT: z.coerce.number().int().positive().default(8788),

  // Scout runner: master mnemonic for deriving per-agent hot wallets
  SCOUT_MASTER_MNEMONIC: z.string().optional(),

  // ERC-8004 validator wallet for on-chain reputation feedback. Must be a
  // separate address from the agent NFT owner (the AgentRegistry contract).
  VALIDATOR_PRIVATE_KEY: z.string().optional(),
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

/// Sanitize a private key from the environment. Env files (especially with CRLF
/// line endings on Windows, or values pasted with quotes) often carry a trailing
/// \r or surrounding quotes that make viem reject the key. Trim those, add the 0x
/// prefix if missing, and validate the shape. An invalid key returns undefined so
/// the coordinator runs in log-only mode with a clear warning instead of crash-looping.
function normalizePrivateKey(raw?: string, name = "COORDINATOR_PRIVATE_KEY"): `0x${string}` | undefined {
  if (!raw) return undefined;
  let v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  if (!v) return undefined;
  if (!v.startsWith("0x")) v = `0x${v}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) {
    console.warn(
      `${name} is set but is not a 32-byte hex key (got ${v.length} chars after cleanup). ` +
        "Ignoring it. Expected 0x followed by 64 hex characters.",
    );
    return undefined;
  }
  return v as `0x${string}`;
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
  adminToken: env.ADMIN_TOKEN,
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
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
      botUsername: env.TELEGRAM_BOT_USERNAME,
    },
    discord: {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      callbackUrl: env.DISCORD_CALLBACK_URL,
    },
  },
  training: {
    baseSecondsPerLevel: env.TRAINING_BASE_SECONDS_PER_LEVEL,
  },
  coordinator: {
    privateKey: normalizePrivateKey(env.COORDINATOR_PRIVATE_KEY),
    wsPort: env.WS_PORT,
  },
  scout: {
    masterMnemonic: env.SCOUT_MASTER_MNEMONIC?.trim() || undefined,
  },
  validator: {
    privateKey: normalizePrivateKey(env.VALIDATOR_PRIVATE_KEY, "VALIDATOR_PRIVATE_KEY"),
  },
  circle: {
    apiKey: env.CIRCLE_API_KEY,
    entitySecret: env.CIRCLE_ENTITY_SECRET,
    walletSetId: env.CIRCLE_WALLET_SET_ID,
    blockchain: env.CIRCLE_BLOCKCHAIN,
    autoSeedUsdc: env.CIRCLE_AUTO_SEED_USDC,
  },
  webauthn: {
    rpName: env.WEBAUTHN_RP_NAME,
    rpId: env.WEBAUTHN_RP_ID,
    origin: env.WEBAUTHN_ORIGIN,
  },
  llm: {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    dailyKillUsd: env.LLM_DAILY_KILL_USD,
    model: env.LLM_MODEL,
    modelTier4: env.LLM_MODEL_TIER4,
    testing: env.LLM_TESTING,
  },
} as const;

export type AppConfig = typeof config;
