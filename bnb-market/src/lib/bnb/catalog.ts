import { BNB_CHAINS, BNB_MAINNET_ID, BNB_TESTNET_ID, type BnbChainId } from "@/lib/bnb/chains";

export type BnbCategory =
  | "rebalancing"
  | "grid-trading"
  | "yield-optimisation"
  | "health-factor";

export interface ProofLayer {
  ownerMatch: "fresh" | "outdated" | "missing";
  endpointStatus: "live" | "unreachable" | "unknown";
  lastSeen: string;
  hasEvidence: boolean;
}

export interface BnbService {
  id: string;
  chainId: BnbChainId;
  name: string;
  provider: string;
  category: BnbCategory;
  shortGoal: string;
  description: string;
  price: string;
  priceModel: string;
  authorityNeed: string;
  authorityScope: string;
  outcome: string;
  metricLabel: string;
  metricValue: string;
  active: boolean;
  supportsRevoke: boolean;
  supportsTestJob: boolean;
  statusNote: string;
  proof: ProofLayer;
  tags: string[];
  docsUrl?: string;
  txAnchor?: string;
}

export interface BnbCategoryMeta {
  id: BnbCategory;
  name: string;
  oneLineGoal: string;
  prompt: string;
  trackColor: string;
}

export const BNB_CATEGORIES: BnbCategoryMeta[] = [
  {
    id: "rebalancing",
    name: "Rebalancing",
    oneLineGoal: "Keep LP exposure near target ranges as price drifts.",
    prompt: "Use an LP rebalance agent",
    trackColor: "var(--warn)",
  },
  {
    id: "grid-trading",
    name: "Grid Trading",
    oneLineGoal: "Run bounded buy/sell bands around a price corridor.",
    prompt: "Try a grid trading agent",
    trackColor: "var(--accent)",
  },
  {
    id: "yield-optimisation",
    name: "Yield Optimisation",
    oneLineGoal: "Move assets for better net yield while staying within your risk cap.",
    prompt: "Use a yield optimisation agent",
    trackColor: "var(--ok)",
  },
  {
    id: "health-factor",
    name: "Health Factor",
    oneLineGoal: "Protect leveraged lending positions before liquidation risk rises.",
    prompt: "Use a health-factor monitoring agent",
    trackColor: "var(--ok)",
  },
];

const catalogData: BnbService[] = [
  {
    id: "bnb-rebalance-bsc-main-01",
    chainId: BNB_MAINNET_ID,
    name: "RangeKeeper Rebalancer",
    provider: "Pancake Strategy Labs",
    category: "rebalancing",
    shortGoal: "Keep LP banding active as price moves.",
    description:
      "Watches concentration and swaps liquidity only when the range is outside a safe operating band. Includes explicit cap and expiry in every prepared action.",
    price: "0.0014",
    priceModel: "USDC / request",
    authorityNeed: "Spend-limited wallet session",
    authorityScope: "approveSwapRange + revokeAfterMinutes",
    outcome: "Better range quality with bounded cost.",
    metricLabel: "Last observed rebalance gap",
    metricValue: "3.2% max",
    active: true,
    supportsRevoke: true,
    supportsTestJob: true,
    statusNote: "Live endpoint probe succeeded in the last check.",
    proof: {
      ownerMatch: "fresh",
      endpointStatus: "live",
      lastSeen: "8 min ago",
      hasEvidence: true,
    },
    tags: ["PancakeSwap LP", "BSC", "risk-limited session"],
    docsUrl: "https://docs.bnbchain.org",
  },
  {
    id: "bnb-rebalance-bsc-main-02",
    chainId: BNB_MAINNET_ID,
    name: "BandGuard LP Operator",
    provider: "Altana Ops",
    category: "rebalancing",
    shortGoal: "Auto-correct concentrated LP for two-token pairs.",
    description:
      "Provides explicit range metadata so a buyer can verify every action before launch. Supports manual session revoke.",
    price: "0.0021",
    priceModel: "USDC / run",
    authorityNeed: "Session key with one-hour expiry",
    authorityScope: "swapWithinRange, rebalance",
    outcome: "Stabilized LP behavior in active pairs.",
    metricLabel: "Range adherence",
    metricValue: "84%",
    active: true,
    supportsRevoke: true,
    supportsTestJob: true,
    statusNote: "Endpoint and ownership checks pass; freshness is good.",
    proof: {
      ownerMatch: "fresh",
      endpointStatus: "live",
      lastSeen: "22 min ago",
      hasEvidence: true,
    },
    tags: ["Concentrated liquidity", "session controls", "watchlist"],
    docsUrl: "https://docs.altana.network",
  },
  {
    id: "bnb-grid-bsc-main-01",
    chainId: BNB_MAINNET_ID,
    name: "GridPilot",
    provider: "TermiX Labs",
    category: "grid-trading",
    shortGoal: "Run bounded grid orders with explicit ceilings.",
    description:
      "Executes only within the configured band and enforces total budget caps before any swap.",
    price: "0.0030",
    priceModel: "USDC / run",
    authorityNeed: "Bounded trade-call key",
    authorityScope: "placeGridOrder, cancelGridOrder",
    outcome: "Lower-cost execution with policy guardrails.",
    metricLabel: "Budget utilization",
    metricValue: "61%",
    active: true,
    supportsRevoke: true,
    supportsTestJob: true,
    statusNote: "Live grid simulation and endpoint check recorded.",
    proof: {
      ownerMatch: "outdated",
      endpointStatus: "live",
      lastSeen: "1h 12m ago",
      hasEvidence: true,
    },
    tags: ["Grid", "bounded execution", "revocable authority"],
  },
  {
    id: "bnb-grid-bsc-test-01",
    chainId: BNB_TESTNET_ID,
    name: "SafeBand Grid",
    provider: "BNB Builders",
    category: "grid-trading",
    shortGoal: "Conservative order-grid helper for dry-run flow.",
    description:
      "Testnet-first grid control with explicit pause, revoke, and limit settings.",
    price: "0.0000",
    priceModel: "Testnet rehearsal",
    authorityNeed: "Bounded signer session",
    authorityScope: "placeOrder, cancelOrder",
    outcome: "Safer onboarding before public launch.",
    metricLabel: "Order cancel latency",
    metricValue: "12 s",
    active: true,
    supportsRevoke: true,
    supportsTestJob: false,
    statusNote: "No paid route yet; available for rehearsal only.",
    proof: {
      ownerMatch: "fresh",
      endpointStatus: "live",
      lastSeen: "18 min ago",
      hasEvidence: true,
    },
    tags: ["Grid", "testnet", "rehearsal route"],
  },
  {
    id: "bnb-yield-bsc-main-01",
    chainId: BNB_MAINNET_ID,
    name: "YieldBalancer",
    provider: "Pancake Capital",
    category: "yield-optimisation",
    shortGoal: "Re-allocate idle assets into higher-yield vaults.",
    description:
      "Compares vault APR windows and proposes moves with clear expected slippage and gas assumptions.",
    price: "0.0025",
    priceModel: "USDC / move",
    authorityNeed: "Budgeted vault move session",
    authorityScope: "depositToVault, withdrawFromVault",
    outcome: "Net APY improvement with bounded exposure.",
    metricLabel: "Projected gross APR gain",
    metricValue: "1.9%",
    active: true,
    supportsRevoke: true,
    supportsTestJob: true,
    statusNote: "Endpoint is responsive, owner proof is stale.",
    proof: {
      ownerMatch: "outdated",
      endpointStatus: "live",
      lastSeen: "3h 03m ago",
      hasEvidence: true,
    },
    tags: ["Yield", "vaults", "APY window"],
  },
  {
    id: "bnb-yield-bsc-main-02",
    chainId: BNB_MAINNET_ID,
    name: "VaultPulse Optimiser",
    provider: "DeFi Ledger",
    category: "yield-optimisation",
    shortGoal: "Move between protocols by expected net output.",
    description:
      "Works only with provider-approved vault list and explicit slippage caps.",
    price: "0.0018",
    priceModel: "USDC / evaluation",
    authorityNeed: "Session-scoped movement allowance",
    authorityScope: "queryVaults, rebalancePosition",
    outcome: "Better routing with fewer silent side effects.",
    metricLabel: "Net APR delta",
    metricValue: "2.4%",
    active: true,
    supportsRevoke: true,
    supportsTestJob: true,
    statusNote: "Ownership is stale in public index, so action is disabled until refreshed.",
    proof: {
      ownerMatch: "outdated",
      endpointStatus: "live",
      lastSeen: "2h 02m ago",
      hasEvidence: false,
    },
    tags: ["Vault routing", "APY", "restricted scope"],
  },
  {
    id: "bnb-hf-bsc-main-01",
    chainId: BNB_MAINNET_ID,
    name: "Liquid Guard",
    provider: "RiskOps",
    category: "health-factor",
    shortGoal: "Warn and act before health factor drops into danger.",
    description:
      "Monitors collateral health and prepares bounded action plans based on your policy profile.",
    price: "0.0012",
    priceModel: "USDC / check + action",
    authorityNeed: "Callable debt and collateral actions",
    authorityScope: "checkHealth, reduceRisk",
    outcome: "Fewer liquidation-triggered drains.",
    metricLabel: "Health threshold coverage",
    metricValue: "97%",
    active: true,
    supportsRevoke: true,
    supportsTestJob: true,
    statusNote: "Live health feed probe and endpoint signature recorded.",
    proof: {
      ownerMatch: "fresh",
      endpointStatus: "live",
      lastSeen: "6 min ago",
      hasEvidence: true,
    },
    tags: ["Lending", "monitoring", "policy-led actions"],
  },
  {
    id: "bnb-hf-bsc-main-02",
    chainId: BNB_MAINNET_ID,
    name: "BorrowSafe Shield",
    provider: "SafeVault Network",
    category: "health-factor",
    shortGoal: "Automate warning-to-action sequences safely.",
    description:
      "Tracks each account’s health trajectory and emits clear intervention options before action.",
    price: "0.0010",
    priceModel: "USDC / policy run",
    authorityNeed: "Health-read + optional risk action",
    authorityScope: "readOnly, repayWithCap",
    outcome: "Visible and auditable risk management.",
    metricLabel: "Median response time",
    metricValue: "23 s",
    active: false,
    supportsRevoke: true,
    supportsTestJob: false,
    statusNote: "Endpoint is reachable; ownership not yet verified on BSC Mainnet.",
    proof: {
      ownerMatch: "missing",
      endpointStatus: "live",
      lastSeen: "26 min ago",
      hasEvidence: false,
    },
    tags: ["Risk", "read-only-first", "ownership pending"],
  },
  {
    id: "bnb-hf-bsc-test-01",
    chainId: BNB_TESTNET_ID,
    name: "SafeBorrow Simulator",
    provider: "BNB Builders",
    category: "health-factor",
    shortGoal: "Simulate risk response paths in rehearsal mode.",
    description:
      "Testnet safety-first flow for alert + optional action design.",
    price: "0.0000",
    priceModel: "Testnet rehearsal",
    authorityNeed: "Read-cap only by default",
    authorityScope: "readPosition, proposeAction",
    outcome: "Fast onboarding and safety checks.",
    metricLabel: "Dry-run approval rate",
    metricValue: "99%",
    active: true,
    supportsRevoke: true,
    supportsTestJob: false,
    statusNote: "No signed action route enabled yet.",
    proof: {
      ownerMatch: "fresh",
      endpointStatus: "live",
      lastSeen: "12 min ago",
      hasEvidence: true,
    },
    tags: ["Health", "simulator", "read-only-first"],
  },
];

export const TOTAL_MAINNET_SERVICES = catalogData.filter((svc) => svc.chainId === BNB_MAINNET_ID).length;
export const TOTAL_TESTNET_SERVICES = catalogData.filter((svc) => svc.chainId === BNB_TESTNET_ID).length;

export function listServices(chainId: BnbChainId): BnbService[] {
  return catalogData.filter((svc) => svc.chainId === chainId);
}

export function listCategoryServices(chainId: BnbChainId, category?: BnbCategory | "all") {
  const services = listServices(chainId);
  if (!category || category === "all") return services;
  return services.filter((svc) => svc.category === category);
}

export function findServiceById(serviceId: string, chainId: BnbChainId): BnbService | null {
  return catalogData.find((svc) => svc.id === serviceId && svc.chainId === chainId) ?? null;
}

export function listCategoryOptions(chainId: BnbChainId) {
  const services = listServices(chainId);
  return BNB_CATEGORIES.map((category) => {
    const count = services.filter((svc) => svc.category === category.id && svc.active).length;
    return { ...category, count };
  });
}

export function formatNetworkCountLabel(chainId: BnbChainId): string {
  const network = BNB_CHAINS.find((item) => item.id === chainId);
  const count = listServices(chainId).filter((svc) => svc.active).length;
  if (!network) return `${count} active service`;
  return `${network.label}: ${count} active service${count === 1 ? "" : "s"}`;
}
