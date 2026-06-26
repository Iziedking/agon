import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
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
  SUPPORT_TOKEN: z.string().optional(), // read-only admin tier (Members/Events/Audit, no money actions)
  AUTH_PORT: z.coerce.number().int().positive().default(8082),
  AUTH_DOMAIN: z.string().default("localhost:3000"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  X_CALLBACK_URL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  // Telegram chat the in-app feedback widget relays bug/idea reports to.
  FEEDBACK_TELEGRAM_CHAT_ID: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_CALLBACK_URL: z.string().optional(),

  // Email OTP at first signup. When enabled, a never-seen email must
  // prove ownership via a 6-digit code before the passkey-enrollment
  // path runs. Returning passkey users skip this; the passkey itself
  // is the proof. OTP_PEPPER salts the at-rest code hash so a DB leak
  // doesn't expose live codes.
  EMAIL_OTP_ENABLED: z.coerce.boolean().default(false),
  EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
  EMAIL_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  OTP_PEPPER: z.string().optional(),

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
  // ORIGIN="http://localhost:3000". For prod, RP_ID="arcrun.xyz" and
  // ORIGIN="https://arcrun.xyz".
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
  // the LLM at all; tier 2 and up share this model. Defaults to Haiku 4.5
  // to keep testnet cost predictable.
  LLM_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  // Optional override applied ONLY to tier 4 agents. When set, tier 4 calls
  // use this model while tiers 2 and 3 stay on LLM_MODEL. Typical values
  // are claude-sonnet-4-6 or claude-opus-4-7. Leave unset on testnet to
  // keep costs low.
  LLM_MODEL_TIER4: z.string().optional(),
  // OpenRouter routes the per-tier reasoning models for missions (llama / gpt /
  // claude) through one OpenAI-compatible endpoint. Required for tiers 0-3.
  OPENROUTER_API_KEY: z.string().optional(),
  // Per-tier reasoning models. Tiers 0-3 are OpenRouter slugs (have a "/");
  // tier 4 is the Anthropic Haiku id (uses ANTHROPIC_API_KEY). Override per env.
  TIER0_MODEL: z.string().default("meta-llama/llama-3.2-1b-instruct"),
  TIER1_MODEL: z.string().default("meta-llama/llama-3.2-3b-instruct"),
  TIER2_MODEL: z.string().default("meta-llama/llama-3.1-8b-instruct"),
  TIER3_MODEL: z.string().default("openai/gpt-4o-mini"),
  TIER4_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  // Live-data mission sources (v2 diversity). Each is optional; the generator
  // uses whichever are set and falls back to LLM/canned otherwise.
  EXA_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  GRAPH_API_KEY: z.string().optional(),
  // Comma-separated The Graph gateway subgraph ids to draw on-chain subjects
  // from. Default is the Uniswap v3 mainnet subgraph (deep, reliable data).
  GRAPH_SUBGRAPH_IDS: z.string().default("5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV"),
  // Testing safety belt. When true:
  //  - web_search tool is stripped from every tier (avoids $0.01/search)
  //  - max_tokens is clamped to 200 regardless of POWER stat
  //  - retries are disabled
  // Use during test runs so the cost ceiling stays predictable.
  LLM_TESTING: z.coerce.boolean().default(false),

  // Agent training. Cost to go from level N to N+1 is (N+1) × 50 Cycles and
  // (N+1) × this many real seconds. Default 3600 = 60 minutes per level base
  // (so level 5 takes 6h). Long enough that the speedup ladder is worth
  // paying for. Set low (e.g. 30) in test environments so a training cycle
  // finishes quickly.
  TRAINING_BASE_SECONDS_PER_LEVEL: z.coerce.number().int().positive().default(3600),
  // Speedup ladder: each +50 cycles spent at start time shaves 15 min off
  // the queue duration. Lets operators trade Cycles for wall-clock when
  // they want to enter the next contest without waiting an hour.
  TRAINING_SPEEDUP_CYCLES_PER_STEP: z.coerce.number().int().positive().default(50),
  TRAINING_SPEEDUP_SECONDS_PER_STEP: z.coerce.number().int().positive().default(900),
  // Hard floor so a fully sped-up training still takes 60 seconds (visible
  // wait, audit row gets a sensible duration).
  TRAINING_MIN_SECONDS: z.coerce.number().int().positive().default(60),
  // Scales the whole per-level time ladder (level 1 present, 2 = 24h, 3 = 72h,
  // 4 = 5d, 5 = 7d). 1 = production. Set small (e.g. 0.002) to shrink waits in
  // test environments.
  TRAINING_TIME_SCALE: z.coerce.number().positive().default(1),

  // Coordinator service
  COORDINATOR_PRIVATE_KEY: z.string().optional(),
  // Treasury EOA key. PrizeEscrow sends listing fees and platform-fee skims
  // straight to the treasury address, so the admin treasury withdraw must sign
  // with THIS key, not the coordinator's. Optional: when unset, the withdraw
  // only works if the on-chain treasury equals the coordinator address.
  TREASURY_PRIVATE_KEY: z.string().optional(),
  WS_PORT: z.coerce.number().int().positive().default(8788),

  // Scout runner: master mnemonic for deriving per-agent hot wallets
  SCOUT_MASTER_MNEMONIC: z.string().optional(),
  // Scout real DEX swaps (Circle App Kit Swap on Arc). Needs CIRCLE_KIT_KEY
  // and the @circle-fin/adapter-viem-v2 package installed. When off or
  // unconfigured, Scout self-transfers USDC instead.
  SCOUT_REAL_SWAPS: z.coerce.boolean().default(false),
  CIRCLE_KIT_KEY: z.string().optional(),
  SCOUT_SWAP_TOKEN_IN: z.string().default("USDC"),
  SCOUT_SWAP_TOKEN_OUT: z.string().default("EURC"),
  // Generic daily swap budget shared by every tier.
  SCOUT_DAILY_SWAP_CAP: z.coerce.number().int().positive().default(5000),
  // How many swaps a single contest run performs (bounded by the daily cap).
  SCOUT_SWAPS_PER_RUN: z.coerce.number().int().positive().default(24),
  // Per-tier hot-wallet funding in whole USDC, comma-separated, index 0..4.
  // This is how much USDC the coordinator puts into each agent's hot wallet
  // before a Scout/Volume round, so it sets the size of swaps and transfers.
  // The float is swept back after settlement, so a higher number costs only
  // gas/swap fees, not the principal. Custom campaigns can raise an agent's
  // working balance further when their requirements are wired in.
  SCOUT_FUNDING_BY_TIER: z
    .string()
    .default("10,25,40,70,100")
    .transform((s) => s.split(",").map((n) => Number(n.trim()))),
  // Per-tier SIZE of each swap/transfer in whole USDC, index 0..4. Separate from
  // funding so the wallet can hold more than one swap's worth, which is what
  // lets the whale-type size traits actually buy bigger trades. The base per
  // op: tier 0 = 2, tier 1 = 5, tier 2 = 10, tier 3 = 15, tier 4 = 25. Trait
  // size multipliers scale this up (clamped by the wallet's spendable balance
  // and SCOUT_SWAP_MAX_USDC), so a higher tier or a whale agent moves more per op.
  SCOUT_SWAP_SIZE_BY_TIER: z
    .string()
    .default("2,5,10,15,25")
    .transform((s) => s.split(",").map((n) => Number(n.trim()))),
  // Safety ceiling on the per-round transfer, so a misconfigured tier value
  // can't drain the coordinator wallet before the sweep returns the float.
  // Set above the largest tier amount so it never clips normal funding.
  SCOUT_FUND_MAX_USDC: z.coerce.number().nonnegative().default(200),

  // ERC-8004 validator wallet for on-chain reputation feedback. Must be a
  // separate address from the agent NFT owner (the AgentRegistry contract).
  VALIDATOR_PRIVATE_KEY: z.string().optional(),

  // Arcana Markets (external prediction-market integration). Live contract
  // on Arc Testnet; owner is a single EOA. The indexer subscribes to its
  // events; the Analyst runner reads open markets here.
  ARCANA_MARKETS_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default("0x443a47eF1025e047879b1BA08c94e6dedB354D54")
    .transform((v) => v as `0x${string}`),
  ARCANA_START_BLOCK: z.coerce.bigint().nonnegative().default(43667548n),
  ARCANA_INDEXING: z.coerce.boolean().default(true),

  // Weekly syndicate reward pool, in whole USDC. At each ISO-week close the
  // coordinator splits this across every member by their contribution share
  // that week, and members claim their slice from the dashboard (paid from the
  // treasury/coordinator wallet, same dev-controlled path as withdrawals).
  // Default 0 disables the pool, so it ships dark until funded.
  SYNDICATE_POOL_WEEKLY_USDC: z.coerce.number().nonnegative().default(0),
  // Preferred sizing: the weekly pool is this percent of the platform fees
  // collected that week (e.g. 20 = 20%). When > 0 it wins over the fixed
  // amount above. The pool goes to the winning syndicate (war rank 1); its
  // members claim a share weighted by their contribution that week.
  SYNDICATE_POOL_FEE_PCT: z.coerce.number().min(0).max(100).default(0),

  // Analyst autofund. Coordinator drips USDC to an agent's hot wallet when
  // it enters an Analyst contest and is under-funded, so agents can actually
  // trade on Arcana. Per-agent: one drip per UTC day. Global: a daily cap so
  // a misconfigured loop can't drain the coordinator wallet.
  //
  // The Circle Arc Testnet faucet refreshes ~$20 USDC per 2 hours
  // (~$240/day capacity), so the $50/day default cap is well within budget.
  // PREDICTION events hold for Arcana when this is false (default): if no
  // open Arcana markets exist at settlement time, the runner returns empty
  // results and the coordinator cancels the contest/challenge and refunds.
  // Set ANALYST_ALLOW_SYNTHETIC=1 to keep the legacy synthetic Brier
  // fallback (dev / no-Arcana environments only).
  ANALYST_ALLOW_SYNTHETIC: z.coerce.boolean().default(false),
  ANALYST_AUTOFUND: z.coerce.boolean().default(true),
  // Per-tier drip amounts in whole USDC. Four comma-separated values for
  // tiers 1..4 (tier 0 is ineligible for Analyst Arcana contests). Defaults
  // match the tier-cap ladder: T1=5, T2=10, T3=15, T4=25.
  ANALYST_AUTOFUND_USDC_BY_TIER: z.string().default("5,10,15,25"),
  // Legacy single-value fallback. If ANALYST_AUTOFUND_USDC_BY_TIER is unset
  // and this is set, every tier gets the same amount. Kept for back-compat.
  ANALYST_AUTOFUND_USDC: z.coerce.number().nonnegative().optional(),
  ANALYST_AUTOFUND_DAILY_USD: z.coerce.number().nonnegative().default(50),
  ANALYST_AUTOFUND_MIN_BALANCE: z.coerce.number().nonnegative().default(1),

  // Nanopayments (Circle Gateway + x402). Lets the Solver runner pay for
  // research per puzzle. Shells to `circle services pay` so the CLI must be
  // installed on the runtime image (`npm i -g @circle-fin/cli`). Per-tier
  // budgets cap spend per puzzle. Tier 0 is the cheapest; tier 4 has the
  // biggest research budget. Caps are enforced in the runner because
  // Circle's `wallet limit set` policy is mainnet-only.
  NANOPAY_ENABLED: z.coerce.boolean().default(false),
  // Which x402 payment path to use:
  //   "sdk" - @circle-fin/x402-batching GatewayClient (container-native, real
  //           payments, signs from NANOPAY_WALLET_PRIVATE_KEY). Recommended.
  //   "exact" - standard x402 "exact" scheme via x402-fetch, signed from
  //           NANOPAY_WALLET_PRIVATE_KEY. Pays normal x402 sellers (Gloria,
  //           Exa) directly on their chain (Base). Container-native, real USDC.
  //   "cli" - shell out to `circle services pay` (needs the Circle CLI + local
  //           auth state). The legacy default.
  // "auto" routes PER SELLER: GatewayWalletBatched sellers (Predexon) settle via
  // the Gateway batching client, standard "exact" sellers (Exa, Gloria) via the
  // exact client, so one mission round can pay several services correctly.
  NANOPAY_PROVIDER: z.enum(["cli", "sdk", "exact", "auto"]).default("cli"),
  // Network the exact-scheme sellers settle on (x402 network name), e.g.
  // base | base-sepolia | polygon. Gloria/Exa declare "base" (mainnet).
  NANOPAY_EXACT_NETWORK: z.string().default("base"),
  // Private key of the Gateway-funded agent wallet that pays for research via
  // the SDK. Only used when NANOPAY_PROVIDER=sdk.
  NANOPAY_WALLET_PRIVATE_KEY: z.string().optional(),
  // Gateway chain the agent wallet deposited into (where its Gateway balance
  // lives). One of @circle-fin/x402-batching's SupportedChainName, e.g.
  // baseSepolia / polygonAmoy / arcTestnet. Default matches the BASE deposit
  // flow in the setup docs.
  NANOPAY_GATEWAY_CHAIN: z.string().default("baseSepolia"),
  NANOPAY_CLI_PATH: z.string().default("circle"),
  // When the Circle CLI isn't installed (e.g. a slim container), fetch the
  // research endpoint directly over HTTPS so the agent still gets real data.
  // The x402 paid call stays primary; this is the fallback when it can't run.
  // Off by default so behavior is unchanged unless explicitly enabled.
  NANOPAY_HTTP_FALLBACK: z.coerce.boolean().default(false),
  // Optional per-host API keys for the direct-HTTP fallback, as a JSON object
  // keyed by hostname, e.g. {"api.exa.ai":"...","api.itsgloria.ai":"..."}.
  // Sent as `Authorization: Bearer <key>` and `x-api-key: <key>`.
  NANOPAY_API_KEYS: z.string().default("{}"),
  // Circle Agent wallet address that pays for x402 research. Created via
  // `circle wallet create --type agent`, funded via `circle gateway deposit`.
  // The wallet's keys live with the operator's CLI login session; the backend
  // shells to `circle services pay --address <this>` and the CLI signs.
  // Distinct identity system from Circle Dev-Controlled wallets (the SDK
  // path used for email-login operators). Required when NANOPAY_ENABLED=true.
  NANOPAY_WALLET_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "expected an address")
    .optional()
    .transform((v) => (v ? (v as `0x${string}`) : undefined)),
  // Per-puzzle research budget in USDC (decimal). Tier 0 cheapest, tier 4
  // most. Defaults reflect the "agents that can afford better data win"
  // mechanic.
  NANOPAY_TIER_0_BUDGET_USDC: z.coerce.number().nonnegative().default(0.01),
  NANOPAY_TIER_1_BUDGET_USDC: z.coerce.number().nonnegative().default(0.05),
  NANOPAY_TIER_2_BUDGET_USDC: z.coerce.number().nonnegative().default(0.25),
  NANOPAY_TIER_3_BUDGET_USDC: z.coerce.number().nonnegative().default(1.0),
  NANOPAY_TIER_4_BUDGET_USDC: z.coerce.number().nonnegative().default(5.0),
  // Chain to settle x402 payments on. Most paid endpoints accept Polygon
  // (MATIC) via Gateway; the tier-pool wallets deposit on Arc and Gateway
  // routes the spend. Override per-environment as the marketplace shifts.
  NANOPAY_SETTLEMENT_CHAIN: z.string().default("MATIC"),
  // Hard ceiling per call so a runaway prompt can't burn the pool.
  NANOPAY_MAX_PER_CALL_USDC: z.coerce.number().positive().default(2.0),
  // Research spend is a premium ability: only agents at this tier or above
  // pay for outside data.
  NANOPAY_MIN_RESEARCH_TIER: z.coerce.number().int().min(0).max(4).default(3),
  // Session-lifetime research budget per tier pool in USDC (decimal). The
  // in-memory pool starts at this number and drains as calls settle; the
  // CLI's Gateway balance check is the hard backstop behind it.
  NANOPAY_SESSION_BUDGET_USDC: z.coerce.number().nonnegative().default(2.0),
  // Default chain for solver web-search research (Exa sells on Base).
  NANOPAY_RESEARCH_CHAIN: z.string().default("BASE"),
  // Analyst research: paid crypto news headlines fetched before trade
  // picks. Gloria AI sells 20 sentiment-tagged headlines per keyword for
  // $0.05, settled as plain on-chain USDC on Base (the agent wallet's
  // Base USDC balance pays, NOT the Gateway pool; keep it topped up).
  NANOPAY_ANALYST_NEWS_ENDPOINT: z.string().optional(),
  NANOPAY_ANALYST_NEWS_LABEL: z.string().default("Gloria AI news"),
  NANOPAY_ANALYST_NEWS_CHAIN: z.string().default("BASE"),
  // Scout research: paid spot prices fetched before the volume strategy.
  // AIsa's CoinGecko proxy sells prices for $0.008 and settles on Polygon
  // (MATIC), the same Gateway domain the eco deposit funds, so it draws
  // from the existing pool.
  NANOPAY_SCOUT_PRICE_ENDPOINT: z.string().optional(),
  NANOPAY_SCOUT_PRICE_LABEL: z.string().default("AIsa market prices"),
  NANOPAY_SCOUT_PRICE_CHAIN: z.string().default("MATIC"),

  // Prediction-tick scheduler. When true (default), agents make
  // multiple tier-gated decisions across the trade window via the
  // coordinator's tick scheduler. The legacy single-pass analyst runner
  // gates its own trade-creation logic so we don't double-trade. Set to
  // 0 to disable the scheduler and revert to single-pass behavior.
  PREDICTION_TICKS: z.coerce.boolean().default(true),

  // Missions (the agent labor market — full spec in docs/missions.md). A mission
  // is a SOLVER-type contest tagged in the `missions` table: platform-run
  // specialist agents sell intel, operatives (tier 3/4) autonomously decide
  // make (pay an x402 service) vs buy (an on-chain A2A payment to a specialist),
  // synthesize a deliverable, and the top deliverables split the pool. Off by
  // default so the feature ships dark until a coordinator wallet is funded.
  MISSION_ENABLED: z.coerce.boolean().default(false),
  // Default platform mission knobs (used by the autopilot open path).
  // Missions are the headline, heavily-funded events: default 100 USDC, well
  // above ordinary contests (1-10). The coordinator wallet must hold at least
  // this much per mission to fund the pool.
  MISSION_POOL_USDC: z.coerce.number().nonnegative().default(100),
  MISSION_DURATION_SECONDS: z.coerce.number().int().positive().default(900),
  // Operatives need research access, so missions gate to tier 3 and up.
  MISSION_MIN_TIER: z.coerce.number().int().min(0).max(4).default(3),
  // How many fragments a mission's brief asks for (single-source pieces the
  // operative must make or buy before synthesizing).
  MISSION_FRAGMENT_COUNT: z.coerce.number().int().positive().default(3),
  // USDC float funded into each operative hot wallet before the run so it can
  // BUY fragments from specialists. Swept back after settlement, so a higher
  // number costs only gas, not principal.
  MISSION_OPERATIVE_FLOAT_USDC: z.coerce.number().nonnegative().default(2),
  // How many platform specialist (intel-seller) agents to seed per mission.
  MISSION_SPECIALIST_COUNT: z.coerce.number().int().positive().default(2),
  // Reserved agentId base for deriving specialist hot wallets, kept far above
  // any real agent id so specialist wallets never collide with operator agents.
  MISSION_SPECIALIST_AGENT_ID_BASE: z.coerce.number().int().positive().default(900000),
  // Base price (whole USDC, decimal) a specialist quotes for one fragment in the
  // A2A handshake. The specialist may scale this by fragment kind.
  MISSION_INTEL_PRICE_USDC: z.coerce.number().nonnegative().default(0.5),
  // Safety ceiling on total per-round mission funding (operative floats +
  // specialist gas), so a misconfigured float can't drain the coordinator before
  // the post-settlement sweep returns the floats.
  MISSION_FUND_MAX_USDC: z.coerce.number().nonnegative().default(50),
  // Optional model override for the judge that grades deliverables. Falls back to
  // LLM_MODEL when unset. Pin it for determinism on the grading path.
  MISSION_JUDGE_MODEL: z.string().optional(),
  // The bar a mission must clear: if no operative's graded deliverable scores at
  // least this, NOBODY is paid — the pool is cancelled and refunded to the
  // sponsor with "no agent could fulfill it within the window". Keeps missions
  // hard and meaningful (a junk deliverable scores near zero). Set 0 to disable.
  MISSION_MIN_SCORE: z.coerce.number().nonnegative().default(150),

  // ----- v2 mission economy (docs/missions.md section 1c) ---------------------
  // Probability a mission is the EXTERNAL (x402) archetype rather than INTERNAL
  // (the scarce-intel market). 0 = always internal, 1 = always external.
  MISSION_EXTERNAL_FRACTION: z.coerce.number().min(0).max(1).default(0.4),
  // Base intel price band (whole USDC). The mission's weight (pool x difficulty
  // x subject) lerps between these for the platform's base price `b`.
  MISSION_BASE_PRICE_MIN_USDC: z.coerce.number().nonnegative().default(0.5),
  MISSION_BASE_PRICE_MAX_USDC: z.coerce.number().nonnegative().default(5),
  // Operative join fee, basis points of the pool (500 = 5%). Platform-funded
  // missions only; project-funded missions set their own at listing.
  MISSION_OPERATIVE_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(500),
  // Scarce-intel market caps. SEATS = first-come specialist slots; MAX_BUY =
  // pieces one specialist may take; PIECES = total intel pieces minted per
  // mission; OPERATIVE_SEATS = the K cap, sized so a winner profits after fee.
  MISSION_SPECIALIST_SEATS: z.coerce.number().int().positive().default(3),
  MISSION_SPECIALIST_MAX_BUY: z.coerce.number().int().positive().default(2),
  MISSION_INTEL_PIECES: z.coerce.number().int().positive().default(5),
  MISSION_OPERATIVE_SEATS: z.coerce.number().int().positive().default(8),
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

/// The address for a private key env var, or null when unset / malformed.
function addressOfKey(raw: string | undefined, name: string): `0x${string}` | null {
  const key = normalizePrivateKey(raw, name);
  return key ? privateKeyToAccount(key).address : null;
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
  supportToken: env.SUPPORT_TOKEN,
  syndicatePoolWeeklyUsdc: env.SYNDICATE_POOL_WEEKLY_USDC,
  syndicatePoolFeePct: env.SYNDICATE_POOL_FEE_PCT,
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
      feedbackChatId: env.FEEDBACK_TELEGRAM_CHAT_ID,
    },
    discord: {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      callbackUrl: env.DISCORD_CALLBACK_URL,
    },
    emailOtp: {
      enabled: env.EMAIL_OTP_ENABLED,
      provider: env.EMAIL_PROVIDER,
      from: env.EMAIL_FROM,
      resendApiKey: env.RESEND_API_KEY,
      pepper: env.OTP_PEPPER,
    },
  },
  training: {
    baseSecondsPerLevel: env.TRAINING_BASE_SECONDS_PER_LEVEL,
    speedupCyclesPerStep: env.TRAINING_SPEEDUP_CYCLES_PER_STEP,
    speedupSecondsPerStep: env.TRAINING_SPEEDUP_SECONDS_PER_STEP,
    minSeconds: env.TRAINING_MIN_SECONDS,
    timeScale: env.TRAINING_TIME_SCALE,
  },
  coordinator: {
    privateKey: normalizePrivateKey(env.COORDINATOR_PRIVATE_KEY),
    wsPort: env.WS_PORT,
  },
  treasury: {
    privateKey: normalizePrivateKey(env.TREASURY_PRIVATE_KEY, "TREASURY_PRIVATE_KEY"),
    // The on-chain treasury address, derived from the key. Operative join fees
    // are paid here, and refunded from here when a mission cancels. Null when no
    // treasury key is set, in which case the join fee is disabled.
    address: addressOfKey(env.TREASURY_PRIVATE_KEY, "TREASURY_PRIVATE_KEY"),
  },
  scout: {
    masterMnemonic: env.SCOUT_MASTER_MNEMONIC?.trim() || undefined,
    // Real DEX swaps via Circle App Kit Swap (USDC/EURC/cirBTC on Arc).
    // When off, or the kit key / adapter are missing, Scout falls back to
    // USDC self-transfers so the runner always produces volume.
    realSwaps: env.SCOUT_REAL_SWAPS,
    kitKey: env.CIRCLE_KIT_KEY,
    swapTokenIn: env.SCOUT_SWAP_TOKEN_IN,
    swapTokenOut: env.SCOUT_SWAP_TOKEN_OUT,
    dailySwapCap: env.SCOUT_DAILY_SWAP_CAP,
    swapsPerRun: env.SCOUT_SWAPS_PER_RUN,
    fundMaxUsdc: env.SCOUT_FUND_MAX_USDC,
    // Per-agent funding ceiling by tier (index 0..4), in whole USDC. Tier
    // caps how much an agent can put to work; the daily swap budget is the
    // same for every tier, so a smaller agent must swap more to match the
    // volume of a higher tier.
    fundingByTier: env.SCOUT_FUNDING_BY_TIER,
    swapSizeByTier: env.SCOUT_SWAP_SIZE_BY_TIER,
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
    openrouterApiKey: env.OPENROUTER_API_KEY?.trim() || undefined,
    dailyKillUsd: env.LLM_DAILY_KILL_USD,
    model: env.LLM_MODEL,
    modelTier4: env.LLM_MODEL_TIER4,
    // Per-tier reasoning models (index = tier 0..4). Slugs with a "/" route
    // through OpenRouter; bare claude-* ids use the Anthropic key. Drives the
    // mission runner's make-vs-buy reasoning, so tier differentiates capability.
    tierModels: [env.TIER0_MODEL, env.TIER1_MODEL, env.TIER2_MODEL, env.TIER3_MODEL, env.TIER4_MODEL],
    testing: env.LLM_TESTING,
  },
  arcana: {
    address: env.ARCANA_MARKETS_ADDRESS,
    startBlock: env.ARCANA_START_BLOCK,
    indexing: env.ARCANA_INDEXING,
  },
  analyst: {
    allowSyntheticFallback: env.ANALYST_ALLOW_SYNTHETIC,
    predictionTicks: env.PREDICTION_TICKS,
  },
  nanopay: {
    enabled: env.NANOPAY_ENABLED,
    provider: env.NANOPAY_PROVIDER,
    walletPrivateKey: normalizePrivateKey(env.NANOPAY_WALLET_PRIVATE_KEY, "NANOPAY_WALLET_PRIVATE_KEY"),
    gatewayChain: env.NANOPAY_GATEWAY_CHAIN,
    exactNetwork: env.NANOPAY_EXACT_NETWORK,
    cliPath: env.NANOPAY_CLI_PATH,
    httpFallback: env.NANOPAY_HTTP_FALLBACK,
    apiKeysByHost: ((): Record<string, string> => {
      try {
        const parsed = JSON.parse(env.NANOPAY_API_KEYS);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
      } catch {
        return {};
      }
    })(),
    /// Per-tier per-puzzle research budget in USDC (decimal). Index 0 = tier 0.
    perPuzzleByTier: [
      env.NANOPAY_TIER_0_BUDGET_USDC,
      env.NANOPAY_TIER_1_BUDGET_USDC,
      env.NANOPAY_TIER_2_BUDGET_USDC,
      env.NANOPAY_TIER_3_BUDGET_USDC,
      env.NANOPAY_TIER_4_BUDGET_USDC,
    ] as const,
    settlementChain: env.NANOPAY_SETTLEMENT_CHAIN,
    maxPerCallUsdc: env.NANOPAY_MAX_PER_CALL_USDC,
    walletAddress: env.NANOPAY_WALLET_ADDRESS,
    minResearchTier: env.NANOPAY_MIN_RESEARCH_TIER,
    sessionBudgetUsdc: env.NANOPAY_SESSION_BUDGET_USDC,
    researchChain: env.NANOPAY_RESEARCH_CHAIN,
    analystNewsEndpoint: env.NANOPAY_ANALYST_NEWS_ENDPOINT,
    analystNewsLabel: env.NANOPAY_ANALYST_NEWS_LABEL,
    analystNewsChain: env.NANOPAY_ANALYST_NEWS_CHAIN,
    scoutPriceEndpoint: env.NANOPAY_SCOUT_PRICE_ENDPOINT,
    scoutPriceLabel: env.NANOPAY_SCOUT_PRICE_LABEL,
    scoutPriceChain: env.NANOPAY_SCOUT_PRICE_CHAIN,
  },
  mission: {
    enabled: env.MISSION_ENABLED,
    poolUsdc: env.MISSION_POOL_USDC,
    durationSeconds: env.MISSION_DURATION_SECONDS,
    minTier: env.MISSION_MIN_TIER,
    fragmentCount: env.MISSION_FRAGMENT_COUNT,
    operativeFloatUsdc: env.MISSION_OPERATIVE_FLOAT_USDC,
    specialistCount: env.MISSION_SPECIALIST_COUNT,
    specialistAgentIdBase: env.MISSION_SPECIALIST_AGENT_ID_BASE,
    intelPriceUsdc: env.MISSION_INTEL_PRICE_USDC,
    fundMaxUsdc: env.MISSION_FUND_MAX_USDC,
    judgeModel: env.MISSION_JUDGE_MODEL,
    minScore: env.MISSION_MIN_SCORE,
    // v2 economy
    externalFraction: env.MISSION_EXTERNAL_FRACTION,
    basePriceMinUsdc: env.MISSION_BASE_PRICE_MIN_USDC,
    basePriceMaxUsdc: env.MISSION_BASE_PRICE_MAX_USDC,
    operativeFeeBps: env.MISSION_OPERATIVE_FEE_BPS,
    specialistSeats: env.MISSION_SPECIALIST_SEATS,
    specialistMaxBuy: env.MISSION_SPECIALIST_MAX_BUY,
    intelPieces: env.MISSION_INTEL_PIECES,
    operativeSeats: env.MISSION_OPERATIVE_SEATS,
  },
  liveData: {
    exaApiKey: env.EXA_API_KEY?.trim() || undefined,
    firecrawlApiKey: env.FIRECRAWL_API_KEY?.trim() || undefined,
    graphApiKey: env.GRAPH_API_KEY?.trim() || undefined,
    graphSubgraphIds: env.GRAPH_SUBGRAPH_IDS.split(",").map((s) => s.trim()).filter(Boolean),
  },
  analystAutofund: {
    enabled: env.ANALYST_AUTOFUND,
    /// Per-tier USDC drip amounts. Index 0 = tier 1, index 3 = tier 4.
    /// Parsed from ANALYST_AUTOFUND_USDC_BY_TIER (4 comma-separated whole
    /// USDC values). Falls back to the legacy flat value if the per-tier
    /// var was left at its default and the legacy var is set.
    dripUsdcByTier: parseDripsByTier(
      env.ANALYST_AUTOFUND_USDC_BY_TIER,
      env.ANALYST_AUTOFUND_USDC,
    ),
    dailyCapUsd: env.ANALYST_AUTOFUND_DAILY_USD,
    minBalanceUsdc: env.ANALYST_AUTOFUND_MIN_BALANCE,
  },
} as const;

function parseDripsByTier(byTier: string, legacy?: number): [number, number, number, number] {
  // If the legacy flat var is explicitly set and the per-tier var is at the
  // default, treat the legacy value as canonical for all tiers.
  if (legacy !== undefined && byTier === "5,10,15,25") {
    return [legacy, legacy, legacy, legacy];
  }
  const parts = byTier
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  // Pad / truncate to exactly four entries so callers can index by tier-1.
  const t1 = parts[0] ?? 5;
  const t2 = parts[1] ?? 10;
  const t3 = parts[2] ?? 15;
  const t4 = parts[3] ?? 25;
  return [t1, t2, t3, t4];
}

export type AppConfig = typeof config;
