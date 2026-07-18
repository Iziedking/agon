/// Shared shapes for the missions labor market (full design in docs/missions.md).
/// A mission is a real commission an operative agent completes by sourcing
/// fragments (MAKE by paying a live x402 service, or BUY via an on-chain
/// agent-to-agent payment to a specialist) and producing a deliverable. Every
/// hop settles real USDC on-chain. Missions are DOMAIN-AWARE: the domain decides
/// what "doing the work" means.

/// Which agent family the mission exercises. The domain decides the MAKE/execute
/// path: solver/analyst MAKE by paying an x402 service; scout MAKEs by doing
/// real on-chain DeFi work (swap/LP/borrow/lend) on the existing Scout rails.
export type MissionDomain = "solver" | "analyst" | "scout";

/// The kind of fragment a brief asks for, bound to a live service catalog entry
/// (see templates.ts SERVICE_CATALOG). INTEL = a web fact (Exa), SIGNAL = a news
/// read (Gloria), MARKET = a live value / implied probability (Predexon). Scout
/// missions use ACTION fragments sourced on-chain instead of a paid service.
export type FragmentKind = "intel" | "signal" | "market" | "action";

/// The live service that can MAKE a fragment (solver/analyst domains). Undefined
/// for `action` fragments, which are sourced on-chain by the Scout rails.
export interface FragmentService {
  endpoint: string;
  label: string;
  /// Settlement chain for the x402 call, e.g. "base" | "matic".
  chain: string;
}

/// One piece the deliverable needs. The operative decides per fragment whether to
/// MAKE it (pay the service), BUY it (pay a specialist who already holds it), or
/// SKIP it.
export interface MissionFragment {
  /// Stable id within the mission, e.g. "frag-1".
  id: string;
  kind: FragmentKind;
  /// Human prompt for what this fragment is, fed to the operative's LLM.
  ask: string;
  /// The x402 service that can MAKE this fragment. Undefined for `action`.
  service?: FragmentService;
  /// Ground truth captured at generation. This is exactly what the platform
  /// specialists are seeded to hold, and what the grader's credit gate checks
  /// the deliverable against. Opaque to keep templates flexible.
  truth?: unknown;
}

/// The commission an operative receives for one mission. `missionId` equals the
/// on-chain contestId (missions ride a SOLVER-type contest tagged in the
/// `missions` table; no contract redeploy).
export interface Commission {
  missionId: number;
  domain: MissionDomain;
  templateId: string;
  title: string;
  /// The full brief text shown to the operative and later to the judge.
  brief: string;
  fragments: MissionFragment[];
  /// What the deliverable must be (the synthesis ask, or for scout the on-chain
  /// objective).
  deliverable: string;
  /// v2 economy (docs/missions.md s1c). EXTERNAL missions source data via x402;
  /// INTERNAL run the scarce intel market. `weight` (0..1) and `basePrice6` (the
  /// platform base price `b`) come from computeMissionEconomics.
  archetype: "external" | "internal";
  weight: number;
  basePrice6: bigint;
}

/// The operative's autonomous per-fragment decision. The make-vs-buy choice is
/// driven by the operative's own LLM, not a fixed rule. `action` is not a choice
/// the operative makes: it is forced for an on-chain DeFi (scout) fragment, which
/// is executed rather than made or bought.
export type MakeOrBuy = "make" | "buy" | "skip" | "action";

/// One fragment's decision plus its execution outcome. The on-chain proof
/// (`txHash`) is what the credit-requires-payment grader checks: an x402 tx
/// (make), an a2a_trades tx (buy), or a DeFi action tx (scout).
export interface FragmentDecision {
  fragmentId: string;
  choice: MakeOrBuy;
  /// Short rationale the LLM gave, surfaced on the live stage.
  reason: string;
  /// True once the work for this fragment settled on-chain.
  settled: boolean;
  txHash?: string;
  /// USDC 6-decimals as a string (json-safe). "0" when nothing was paid.
  spent6?: string;
  /// The data/intel obtained, used in synthesis. Opaque.
  data?: unknown;
  /// For a BUY: which specialist served it.
  specialistAgentId?: number;
}

/// The operative's submission before grading.
export interface MissionSubmission {
  agentId: number;
  operator: `0x${string}`;
  decisions: FragmentDecision[];
  /// The synthesized output (solver/analyst), or a summary of the on-chain work
  /// (scout). Graded by judge.ts for quality; gated by payment proof for credit.
  deliverable: string;
  elapsedMs: number;
}

/// A platform-seeded specialist (intel seller). Holds the captured intel for a
/// fragment and prices it; serves it over the A2A handshake when an operative
/// chooses BUY. Has its own hot wallet derived on a reserved agentId range.
export interface Specialist {
  agentId: number;
  address: `0x${string}`;
  missionId: number;
  fragmentId: string;
  /// Quoted price for this fragment, USDC 6-decimals as a string. This is the
  /// ASK, not necessarily what gets paid: see `owner`.
  price6: string;
  /// Who is selling.
  ///   "platform" - a house market-maker. Its ask is NEGOTIABLE: it holds a
  ///                reserve price and will trade down toward it to win the sale.
  ///   "operator" - a REAL USER who listed this intel at a price they chose. The
  ///                ask is FIRM. We do not haggle a human's listing down without
  ///                their consent; that is their money, not ours. A buyer who
  ///                thinks it is overpriced can walk and bargain with the house
  ///                instead, which is the market pressure on operator pricing.
  owner: "platform" | "operator";
  /// The intel this specialist will deliver on a paid BUY.
  intel: unknown;
}
