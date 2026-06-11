/// Run `forge verify-contract` for each ArcRun v0 contract using the
/// addresses and roles captured in contracts/deployments/arc-testnet.json.
/// Encodes constructor args with viem so the verifier can match
/// bytecode against source.
///
/// Dry-run by default: prints the commands it would invoke. Set
/// VERIFY_RUN=1 to actually execute them. Foundry's `forge` must be on
/// PATH (this script shells out; it doesn't reimplement verification).
///
/// Required env at run time:
///   - VERIFIER_URL   — arcscan or whatever the network's verifier
///                       endpoint is (e.g. https://testnet.arcscan.app/api/)
///   - ETHERSCAN_API_KEY — most blockscout / etherscan forks expect this
///                       header even if it's a dummy value
///
/// Override the on-deploy fee values if your deployment used non-default
/// LISTING_FEE / PLATFORM_FEE_BPS; otherwise we read the script defaults
/// (0 / 500) which is what the arc-testnet deploy used.
///
/// Run: `npx tsx backend/scripts/verify-contracts.ts`
/// Live: `VERIFY_RUN=1 VERIFIER_URL=https://testnet.arcscan.app/api/ \
///         ETHERSCAN_API_KEY=any npx tsx backend/scripts/verify-contracts.ts`

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters } from "viem";

// ESM equivalent of CommonJS __dirname. Needed because backend/package.json
// is "type": "module" — node treats this script as ESM and __dirname is
// undefined under those rules.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Deployment {
  network: string;
  chainId: number;
  rpcUrl: string;
  deployer: `0x${string}`;
  roles: {
    admin: `0x${string}`;
    treasury: `0x${string}`;
    coordinator: `0x${string}`;
  };
  contracts: {
    PrizeEscrow: `0x${string}`;
    AgentRegistry: `0x${string}`;
    ContestEngine: `0x${string}`;
    ChallengeArena: `0x${string}`;
    SyndicateFactory: `0x${string}`;
    PointsLedger: `0x${string}`;
  };
  external: {
    USDC: `0x${string}`;
    IdentityRegistry: `0x${string}`;
  };
}

const CONTRACTS_DIR = resolve(__dirname, "..", "..", "contracts");
const DEPLOYMENT_FILE = join(CONTRACTS_DIR, "deployments", "arc-testnet.json");

function loadDeployment(): Deployment {
  const raw = readFileSync(DEPLOYMENT_FILE, "utf8");
  return JSON.parse(raw) as Deployment;
}

interface VerifyJob {
  name: string;
  target: string;
  address: `0x${string}`;
  ctorArgs: `0x${string}`;
}

function buildJobs(d: Deployment): VerifyJob[] {
  const listingFee = BigInt(process.env.LISTING_FEE ?? "0");
  const platformFeeBps = Number(process.env.PLATFORM_FEE_BPS ?? "500");

  const { admin, treasury } = d.roles;
  const usdc = d.external.USDC;
  const identity = d.external.IdentityRegistry;
  const agentRegistry = d.contracts.AgentRegistry;
  const escrow = d.contracts.PrizeEscrow;

  return [
    {
      name: "PrizeEscrow",
      target: "src/PrizeEscrow.sol:PrizeEscrow",
      address: d.contracts.PrizeEscrow,
      ctorArgs: encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "address" }],
        [admin, usdc, treasury],
      ),
    },
    {
      name: "AgentRegistry",
      target: "src/AgentRegistry.sol:AgentRegistry",
      address: d.contracts.AgentRegistry,
      ctorArgs: encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }],
        [admin, identity, usdc, treasury],
      ),
    },
    {
      name: "ContestEngine",
      target: "src/ContestEngine.sol:ContestEngine",
      address: d.contracts.ContestEngine,
      ctorArgs: encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "uint256" },
          { type: "uint16" },
        ],
        [admin, agentRegistry, escrow, listingFee, platformFeeBps],
      ),
    },
    {
      name: "ChallengeArena",
      target: "src/ChallengeArena.sol:ChallengeArena",
      address: d.contracts.ChallengeArena,
      ctorArgs: encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "uint16" },
        ],
        [admin, agentRegistry, escrow, platformFeeBps],
      ),
    },
    {
      name: "SyndicateFactory",
      target: "src/SyndicateFactory.sol:SyndicateFactory",
      address: d.contracts.SyndicateFactory,
      ctorArgs: encodeAbiParameters([{ type: "address" }], [admin]),
    },
    {
      name: "PointsLedger",
      target: "src/PointsLedger.sol:PointsLedger",
      address: d.contracts.PointsLedger,
      ctorArgs: encodeAbiParameters([{ type: "address" }], [admin]),
    },
  ];
}

function commandFor(job: VerifyJob, rpc: string): string {
  const verifierUrl = process.env.VERIFIER_URL ?? "<set-VERIFIER_URL>";
  // Compiler version captured from contracts/foundry.toml. If you bumped
  // it post-deploy, override here so the verifier matches bytecode.
  const compiler = process.env.SOLC_VERSION ?? "0.8.24";
  return [
    "forge verify-contract",
    job.address,
    job.target,
    `--rpc-url ${rpc}`,
    `--compiler-version ${compiler}`,
    "--verifier blockscout",
    `--verifier-url ${verifierUrl}`,
    `--constructor-args ${job.ctorArgs}`,
    "--watch",
  ].join(" ");
}

function main() {
  const deployment = loadDeployment();
  const jobs = buildJobs(deployment);
  const rpc = deployment.rpcUrl;
  const live = process.env.VERIFY_RUN === "1";

  console.log(`forge verify recipe — network ${deployment.network} (chain ${deployment.chainId})`);
  console.log(`rpc: ${rpc}`);
  console.log(`mode: ${live ? "LIVE (executing)" : "DRY-RUN (printing only)"}`);
  if (!process.env.VERIFIER_URL) {
    console.log("warning: VERIFIER_URL not set — fill it in before running live");
  }
  console.log();

  for (const job of jobs) {
    const cmd = commandFor(job, rpc);
    console.log(`# ${job.name}`);
    console.log(cmd);
    console.log();
    if (live) {
      try {
        execSync(cmd, { cwd: CONTRACTS_DIR, stdio: "inherit" });
      } catch (err) {
        console.error(
          `verify failed for ${job.name}: ${err instanceof Error ? err.message : err}`,
        );
        process.exitCode = 1;
      }
    }
  }
}

main();
