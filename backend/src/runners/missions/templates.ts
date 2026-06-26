/// The mission template library. A template is a domain-tagged shell that the
/// generator (built later) binds to live services, filling specifics and
/// capturing ground truth, which is also what the platform specialists are
/// seeded to hold. Templates are declarative so the runner and the generator
/// agree on shape without importing each other.

import type { FragmentKind, MissionDomain } from "./types.js";

/// Static catalog mapping a fragment kind to the live x402 service that MAKEs it.
/// The real endpoint URLs come from config.nanopay at generation time (so the
/// catalog stays free of secrets/URLs); this only fixes the label, the family,
/// and the settlement chain so specialists and the generator line up. `action`
/// has no service: scout fragments are sourced on-chain, not bought from an API.
export interface ServiceCatalogEntry {
  kind: FragmentKind;
  label: string;
  /// Which config.nanopay endpoint to bind, or "onchain" for scout actions.
  configEndpoint: "exaSearch" | "analystNews" | "scoutPrice" | "predexon" | "onchain";
  chain: string;
}

export const SERVICE_CATALOG: Record<FragmentKind, ServiceCatalogEntry> = {
  intel: { kind: "intel", label: "Exa web search", configEndpoint: "exaSearch", chain: "base" },
  signal: { kind: "signal", label: "Gloria AI news", configEndpoint: "analystNews", chain: "base" },
  market: { kind: "market", label: "Predexon prediction markets", configEndpoint: "predexon", chain: "base" },
  action: { kind: "action", label: "On-chain DeFi", configEndpoint: "onchain", chain: "arc" },
};

/// A fragment slot in a template: a kind plus the human ask shell the generator
/// fills with specifics (e.g. an asset, an event, a market).
export interface TemplateFragment {
  kind: FragmentKind;
  /// Ask shell. `{subject}` is replaced by the generator with the chosen specific.
  askShell: string;
}

export interface MissionTemplate {
  id: string;
  domain: MissionDomain;
  title: string;
  /// Brief shell shown to operatives; the generator fills `{subjects}` etc.
  briefShell: string;
  /// What the deliverable must be.
  deliverable: string;
  fragments: TemplateFragment[];
}

/// v1 templates. SOLVER first (the flagship synthesis commission, the cleanest
/// agent-to-agent showcase), ANALYST next (same x402 + A2A wiring). The SCOUT
/// template is declared so the domain is reserved, but its on-chain DeFi
/// execution lands with task #8; the runner only dispatches solver/analyst in v1.
export const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    id: "synthesis-intel-brief",
    domain: "solver",
    title: "Signal Synthesis Brief",
    briefShell:
      "Produce one intelligence brief on {subjects}. Find the underreported or " +
      "underweighted signals across the live sources, reconcile them, and state " +
      "what a decision-maker should conclude right now. Do not pad: surface only " +
      "what the sources actually support.",
    deliverable:
      "A concise intelligence brief (3-6 sentences) that synthesizes the gathered " +
      "fragments into one coherent read, naming the strongest signal and the " +
      "biggest uncertainty.",
    fragments: [
      { kind: "intel", askShell: "The most material recent fact about {subject}." },
      { kind: "signal", askShell: "The bullish/bearish news read on {subject}." },
      { kind: "market", askShell: "The live value or implied probability around {subject}." },
    ],
  },
  {
    id: "prediction-read",
    domain: "analyst",
    title: "Market Read",
    briefShell:
      "Form a calibrated prediction on {subjects}. Use the live news read and the " +
      "market signal to commit a direction and a confidence, and justify it from " +
      "the sources, not priors.",
    deliverable:
      "A committed YES/NO (or directional) call on each subject with a confidence " +
      "(0-100) and a one-line justification grounded in the fragments.",
    // Three buyable pieces so a specialist can reach the two-piece max even after
    // another seat claims one (an analyst mission with only two pieces leaves at
    // most one on the shelf once a specialist buys).
    fragments: [
      { kind: "intel", askShell: "The most material recent fact about {subject}." },
      { kind: "signal", askShell: "The news read that moves {subject}." },
      { kind: "market", askShell: "The current implied probability on {subject}." },
    ],
  },
  {
    id: "liquidity-sweep",
    domain: "scout",
    title: "Liquidity Sweep",
    briefShell:
      "Put working capital to use across {subjects}: route real on-chain DeFi " +
      "actions (swap, provide liquidity, lend) that produce genuine volume. " +
      "Optionally buy intel on where the best venue is before acting.",
    deliverable:
      "Real on-chain DeFi activity (swaps/LP/lends) on the Scout rails, scored on " +
      "the volume and the venues touched.",
    fragments: [
      { kind: "action", askShell: "On-chain DeFi action on {subject}." },
    ],
  },
];

/// Templates available to dispatch in v1 (solver + analyst). Scout is reserved
/// but not executed until task #8 wires the DeFi path.
export const V1_TEMPLATE_DOMAINS: MissionDomain[] = ["solver", "analyst"];

export function templateById(id: string): MissionTemplate | undefined {
  return MISSION_TEMPLATES.find((t) => t.id === id);
}

export function defaultTemplateForDomain(domain: MissionDomain): MissionTemplate | undefined {
  return MISSION_TEMPLATES.find((t) => t.domain === domain);
}
