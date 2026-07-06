/// The mission generator. Turns a declarative template into a live Commission:
/// it picks fresh subjects, fills the brief, produces the per-fragment intel the
/// platform specialists will hold, binds each fragment's MAKE-path x402 service
/// from config, persists the mission + fragments, and seeds the specialists.
///
/// v1 honesty: the ECONOMY is real (real USDC moves on every A2A buy and x402
/// make at run time), but the intel CONTENT is generated here (LLM, with a
/// demo-safe canned fallback) rather than captured from a live feed. Swapping the
/// content source to live ground-truth capture is a later upgrade; the rest of
/// the pipeline does not change.

import { callModel, llmConfigured } from "../llm/client.js";
import { config } from "../../config/index.js";
import { query } from "../../db/pool.js";
import { computeMissionEconomics } from "./economics.js";
import { seedSpecialists } from "./specialists.js";
import { buildLiveMission } from "./liveSources.js";
import {
  randomTemplateForDomain,
  templateById,
  SERVICE_CATALOG,
  type MissionTemplate,
} from "./templates.js";
import type {
  Commission,
  FragmentKind,
  FragmentService,
  MissionDomain,
  MissionFragment,
} from "./types.js";

interface BuiltFragment {
  ask: string;
  intel: string | null;
}
interface Built {
  brief: string;
  fragments: BuiltFragment[];
  /// The subjects the generator chose, lowercased — recorded so future missions
  /// can avoid them for 60 days.
  subjects: string[];
}

/// Resolves the live x402 endpoint that can MAKE a fragment of this kind, read
/// from config.nanopay. Returns undefined for on-chain (scout) fragments and for
/// kinds whose endpoint is not configured in this environment (those fragments
/// become BUY-only, which is still a valid path).
function serviceForKind(kind: FragmentKind): FragmentService | undefined {
  const cat = SERVICE_CATALOG[kind];
  if (!cat || cat.configEndpoint === "onchain") return undefined;
  const np = config.nanopay;
  switch (cat.configEndpoint) {
    case "analystNews":
      return np.analystNewsEndpoint
        ? { endpoint: np.analystNewsEndpoint, label: np.analystNewsLabel, chain: np.analystNewsChain }
        : undefined;
    case "scoutPrice":
      return np.scoutPriceEndpoint
        ? { endpoint: np.scoutPriceEndpoint, label: np.scoutPriceLabel, chain: np.scoutPriceChain }
        : undefined;
    // Exa (intel) and Predexon (market) have no standalone endpoint var in v1,
    // so those fragments are BUY-only until one is wired.
    case "exaSearch":
    case "predexon":
    default:
      return undefined;
  }
}

/// Pulls a JSON object out of a model response, tolerating code fences / prose.
function parseJsonLoose(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/// Asks the model for fresh subjects, a filled brief, and per-fragment intel.
/// Throws on a missing key or malformed JSON so the caller falls back to canned.
async function llmGenerate(template: MissionTemplate, avoid: string[]): Promise<Built> {
  if (!llmConfigured()) throw new Error("llm not configured");
  const n = template.fragments.length;
  const fragSpec = template.fragments
    .map((f, i) => `${i + 1}. kind=${f.kind}, ask shell: "${f.askShell}"`)
    .join("\n");
  const system =
    "You generate fresh, realistic content for a competitive AI-agent mission. " +
    "Variety matters: each mission should feel genuinely different from the last. " +
    "Return ONLY a valid JSON object: no prose, no code fences.";
  // Hand the model the recently-used subjects so it picks genuinely new ground.
  const avoidLine =
    avoid.length > 0
      ? `Do NOT use any of these recently-used subjects (pick clearly different ones, ` +
        `and prefer specific, current, less-obvious picks over the usual BTC/ETH/SOL): ${avoid.slice(0, 60).join(", ")}.\n`
      : "Prefer specific, current, less-obvious subjects over the usual BTC/ETH/SOL.\n";
  const user =
    `Mission: ${template.title}\n` +
    `Brief shell: "${template.briefShell}"\n` +
    `Deliverable: ${template.deliverable}\n\n` +
    `Pick ${n} interesting, current, distinct subjects (crypto assets, live markets, protocols, or recent events). ` +
    avoidLine +
    `Replace {subject} / {subjects} with them. Return JSON of exactly this shape:\n` +
    `{"subjects":["subject1","subject2"],"brief":"<=70 words filling the brief shell","fragments":[{"ask":"filled ask","intel":"1-2 sentence concrete realistic intel a specialist would sell"}]}\n` +
    `CRITICAL: the brief is the ASSIGNMENT shown publicly. State the scenario and what the operative must produce, but DO NOT state any conclusion, signal call, recommendation, or synthesis — that is the operative's deliverable and must not be given away. The "intel" fields ARE the answer pieces (kept private, sold by specialists); the brief is NOT.\n` +
    `Provide exactly ${n} fragments, in this order:\n${fragSpec}`;
  const out = await callModel({
    model: config.llm.model,
    systemPrompt: system,
    userPrompt: user,
    maxTokens: 800,
    temperature: 0.95,
  });
  const parsed = parseJsonLoose(out.text);
  const frags = parsed?.fragments;
  if (!parsed || typeof parsed.brief !== "string" || !Array.isArray(frags) || frags.length < n) {
    throw new Error("malformed mission JSON from model");
  }
  const subjects = Array.isArray(parsed.subjects)
    ? (parsed.subjects as unknown[]).map((s) => String(s).trim()).filter(Boolean)
    : [];
  return {
    brief: parsed.brief,
    subjects,
    fragments: (frags as Array<Record<string, unknown>>).slice(0, n).map((x) => ({
      ask: String(x.ask ?? ""),
      intel: x.intel != null ? String(x.intel) : null,
    })),
  };
}

/// Demo-safe fallback so a mission always generates, even with no LLM key. Uses a
/// rotating set of subjects and plausible per-kind intel.
function cannedIntel(kind: FragmentKind, subject: string): string {
  switch (kind) {
    case "intel":
      return `${subject} shipped a notable protocol update this week that most coverage underweighted.`;
    case "signal":
      return `Headlines on ${subject} skew cautiously bullish: volume is rising while sentiment still lags price.`;
    case "market":
      return `${subject}'s implied near-term upside sits around 55-60% on current market pricing.`;
    case "action":
      return `Liquidity on ${subject} pairs is thin on smaller venues; route through the deepest pool.`;
    default:
      return `${subject}: no specific intel.`;
  }
}

/// A broad subject pool for the keyless fallback, so even without an LLM the
/// canned path rotates through enough names to dodge the 60-day window.
const CANNED_SUBJECTS = [
  "Bitcoin", "Ethereum", "Solana", "Arbitrum", "Optimism", "Base", "Polygon", "Avalanche",
  "Chainlink", "Uniswap", "Aave", "Lido", "Maker", "Curve", "Pendle", "Ethena",
  "Celestia", "Sui", "Aptos", "Sei", "Injective", "TON", "Near", "Cosmos",
  "EigenLayer restaking", "the ETH staking rate", "stablecoin supply growth",
  "L2 sequencer revenue", "RWA tokenization", "a major airdrop unlock",
];

function cannedGenerate(template: MissionTemplate, avoid: string[]): Built {
  const avoidSet = new Set(avoid.map((s) => s.toLowerCase()));
  const fresh = CANNED_SUBJECTS.filter((s) => !avoidSet.has(s.toLowerCase()));
  // Rotate a different window of the pool each time; fall back to the full pool
  // if the avoid list has swallowed almost everything.
  const pool = fresh.length >= template.fragments.length ? fresh : CANNED_SUBJECTS;
  const start = pool.length > 0 ? avoidSet.size % pool.length : 0;
  const pick = (i: number) => pool[(start + i) % pool.length]!;
  const subjects = template.fragments.map((_, i) => pick(i));
  const fragments = template.fragments.map((f, i) => ({
    ask: f.askShell.replace(/\{subject\}/g, subjects[i]!),
    intel: cannedIntel(f.kind, subjects[i]!),
  }));
  return {
    brief: template.briefShell.replace(/\{subjects\}/g, subjects.join(", ")),
    subjects,
    fragments,
  };
}

/// Generates and persists a mission for a contest, seeds its specialists, and
/// returns the Commission. Idempotent: re-generating upserts the rows.
export async function generateMission(opts: {
  contestId: number;
  domain?: MissionDomain;
  templateId?: string;
  poolUsdc?: number;
}): Promise<Commission> {
  // Explicit templateId wins; otherwise rotate randomly within the domain so
  // consecutive missions vary in shape (fragment count, deliverable), not just
  // subject.
  const template =
    (opts.templateId ? templateById(opts.templateId) : undefined) ??
    (opts.domain ? randomTemplateForDomain(opts.domain) : undefined) ??
    randomTemplateForDomain("solver")!;

  // v2 economy: roll the archetype + weight, which set the base intel price.
  const econ = computeMissionEconomics(opts.poolUsdc ?? 100);

  // 60-day no-repeat: hand the generator everything used recently so it picks
  // genuinely fresh subjects and missions stop feeling the same.
  const { rows: recentRows } = await query<{ subject_key: string }>(
    "select subject_key from mission_subjects where created_at > now() - interval '60 days' order by created_at desc limit 200",
  );
  const avoid = recentRows.map((r) => r.subject_key);

  // Prefer a live-data-grounded mission (real Exa/Polymarket/onchain facts) so
  // missions are educative and never repeat; fall back to the LLM, then canned.
  const live = await buildLiveMission(template, avoid).catch(() => null);
  if (live) console.log(`[mission ${opts.contestId}] grounded via live source: ${live.source}`);
  const built = live ?? (await llmGenerate(template, avoid).catch(() => null)) ?? cannedGenerate(template, avoid);

  const fragments: MissionFragment[] = template.fragments.map((tf, i) => {
    const b = built.fragments[i] ?? { ask: tf.askShell, intel: null };
    return {
      id: `f-${i + 1}`,
      kind: tf.kind,
      ask: b.ask,
      service: serviceForKind(tf.kind),
      truth: b.intel ?? null,
    };
  });

  // External missions source data via x402, so every fragment must be MAKE-able
  // (have a wired service) — they carry no intel shelf to buy from. Drop the
  // fragments that can be neither made nor bought; if that would empty the
  // mission, run it as an INTERNAL intel-market mission instead, where the shelf
  // makes every fragment buyable. Either way an external mission is always at
  // least partly solvable.
  let archetype = econ.archetype;
  let missionFragments = fragments;
  if (archetype === "external") {
    const makeable = fragments.filter((f) => f.service != null);
    if (makeable.length > 0) missionFragments = makeable;
    else archetype = "internal";
  }

  const commission: Commission = {
    missionId: opts.contestId,
    domain: template.domain,
    templateId: template.id,
    title: template.title,
    brief: built.brief,
    fragments: missionFragments,
    deliverable: template.deliverable,
    archetype,
    weight: econ.weight,
    basePrice6: econ.basePrice6,
  };

  const poolUsdc6 = BigInt(Math.round((opts.poolUsdc ?? 0) * 1e6)).toString();
  await query(
    `insert into missions (contest_id, domain, template_id, title, brief, deliverable, status, archetype, weight, base_price_usdc_6, pool_usdc_6)
     values ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10)
     on conflict (contest_id) do update set
       domain = excluded.domain, template_id = excluded.template_id, title = excluded.title,
       brief = excluded.brief, deliverable = excluded.deliverable,
       archetype = excluded.archetype, weight = excluded.weight, base_price_usdc_6 = excluded.base_price_usdc_6,
       pool_usdc_6 = excluded.pool_usdc_6`,
    [
      commission.missionId,
      commission.domain,
      commission.templateId,
      commission.title,
      commission.brief,
      commission.deliverable,
      commission.archetype,
      commission.weight,
      commission.basePrice6.toString(),
      poolUsdc6,
    ],
  );
  for (const f of commission.fragments) {
    await query(
      `insert into mission_fragments
         (contest_id, fragment_id, kind, ask, service_endpoint, service_label, service_chain, truth)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (contest_id, fragment_id) do update set
         kind = excluded.kind, ask = excluded.ask, service_endpoint = excluded.service_endpoint,
         service_label = excluded.service_label, service_chain = excluded.service_chain, truth = excluded.truth`,
      [
        commission.missionId,
        f.id,
        f.kind,
        f.ask,
        f.service?.endpoint ?? null,
        f.service?.label ?? null,
        f.service?.chain ?? null,
        JSON.stringify(f.truth ?? null),
      ],
    );
  }

  // Record this mission's subjects so the next 60 days steer clear of them.
  for (const s of built.subjects) {
    const key = s.toLowerCase().trim().slice(0, 200);
    if (!key) continue;
    await query(
      "insert into mission_subjects (subject_key, contest_id) values ($1, $2) on conflict do nothing",
      [key, opts.contestId],
    );
  }

  // Only INTERNAL missions run the intel market, so only they get a platform
  // shelf. EXTERNAL (x402) missions source their data from outside ArcRun.
  if (commission.archetype === "internal") {
    await seedSpecialists(commission);
  }
  return commission;
}

/// Reloads a persisted mission as a Commission. Returns null when the contest is
/// not a mission, which is exactly how the coordinator decides whether to run the
/// MissionRunner or the ordinary SolverRunner.
export async function loadMission(contestId: number): Promise<Commission | null> {
  const { rows: mr } = await query<{
    domain: string;
    template_id: string;
    title: string;
    brief: string;
    deliverable: string;
    archetype: string;
    weight: string;
    base_price_usdc_6: string;
  }>(
    `select domain, template_id, title, brief, deliverable, archetype, weight, base_price_usdc_6
       from missions where contest_id = $1`,
    [contestId],
  );
  const m = mr[0];
  if (!m) return null;

  const { rows: fr } = await query<{
    fragment_id: string;
    kind: string;
    ask: string;
    service_endpoint: string | null;
    service_label: string | null;
    service_chain: string | null;
    truth: unknown;
  }>(
    `select fragment_id, kind, ask, service_endpoint, service_label, service_chain, truth
       from mission_fragments
      where contest_id = $1
      order by fragment_id asc`,
    [contestId],
  );

  const fragments: MissionFragment[] = fr.map((r) => ({
    id: r.fragment_id,
    kind: r.kind as FragmentKind,
    ask: r.ask,
    service: r.service_endpoint
      ? { endpoint: r.service_endpoint, label: r.service_label ?? "", chain: r.service_chain ?? "" }
      : undefined,
    truth: r.truth,
  }));

  return {
    missionId: contestId,
    domain: m.domain as MissionDomain,
    templateId: m.template_id,
    title: m.title,
    brief: m.brief,
    fragments,
    deliverable: m.deliverable,
    archetype: m.archetype === "external" ? "external" : "internal",
    weight: Number(m.weight) || 0,
    basePrice6: BigInt(m.base_price_usdc_6 || "0"),
  };
}
