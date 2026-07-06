import { config } from "../../config/index.js";
import type { MissionTemplate } from "./templates.js";

/// Live-data mission sources (v2 diversity). Each source pulls REAL current data
/// so missions are grounded in the world, educative to watch, and never repeat:
///   - Exa       -> recent web findings (research / solver subjects) [free, primary]
///   - Graph     -> on-chain stats (scout / analyst subjects)        [free, primary]
///   - Llama     -> live DeFi protocol TVL and flows                 [free, keyless]
///   - Polymarket-> live prediction-market implied odds              [free, keyless]
///   - Firecrawl -> capture-anything web search                      [PAID, gated fallback]
///
/// Grounding is PER KIND: `market` fragments take live Polymarket pricing (the
/// implied probability is literally the ask), everything else draws from the
/// domain pool, so one mission can span a news fact, an on-chain metric, and a
/// live market price — each fragment's truth from the source that knows it.
/// Firecrawl is the only paid source, so it is reached only when the free
/// sources come up short and only on FIRECRAWL_FRACTION of missions
/// (see firecrawlAllowed). Set FIRECRAWL_FRACTION=0 to disable it.
///
/// A finding is a real subject + a real fact. The fact becomes the fragment's
/// ground truth (what the grader scores a 1:1 fit against), so the answer is the
/// world's, not the model's. buildLiveMission wraps findings into the Built shape
/// the generator already understands; it returns null whenever the source key is
/// missing or the call fails, so the generator falls back to the LLM/canned path.

export interface LiveFinding {
  subject: string;
  fact: string;
}

interface BuiltLive {
  brief: string;
  fragments: Array<{ ask: string; intel: string | null }>;
  subjects: string[];
  source: string;
}

const TIMEOUT_MS = Number(process.env.LIVE_SOURCE_TIMEOUT_MS ?? "20000");

/// Firecrawl is the only PAID live source (Exa and The Graph are effectively
/// free here), so it is a last resort, not a rotated primary. It is attempted
/// ONLY when the free sources came up short, and even then only on a fraction of
/// missions. FIRECRAWL_FRACTION 0 disables it entirely; 1 always allows the
/// fallback; FIRECRAWL_ENABLED=false also turns it off. The gate keys off the
/// deterministic `rotate` (no Math.random) so a re-run is stable.
const FIRECRAWL_ENABLED = (process.env.FIRECRAWL_ENABLED ?? "true").toLowerCase() !== "false";
const FIRECRAWL_FRACTION = Math.max(0, Math.min(1, Number(process.env.FIRECRAWL_FRACTION ?? "0.2")));
function firecrawlAllowed(rotate: number): boolean {
  if (!config.liveData.firecrawlApiKey || !FIRECRAWL_ENABLED || FIRECRAWL_FRACTION <= 0) return false;
  if (FIRECRAWL_FRACTION >= 1) return true;
  const bucket = Math.max(1, Math.round(1 / FIRECRAWL_FRACTION));
  return rotate % bucket === 0;
}

/// Rotating research angles so the Exa query itself varies run to run. Index is
/// nudged by the avoid-list size so consecutive missions probe different ground.
const EXA_ANGLES = [
  "notable crypto protocol upgrades and launches in the past week",
  "underreported onchain or DeFi developments this week",
  "recent shifts in a major crypto narrative (restaking, RWAs, L2s, AI agents)",
  "a recent regulatory or institutional move affecting crypto markets",
  "a recent security incident, exploit, or depeg and its fallout",
  "an emerging token or protocol gaining real traction this month",
];

/// Exa search -> a handful of real, recent findings. Each result's title is the
/// subject and its snippet the fact. Filters out anything in `avoid`.
async function exaFindings(avoid: string[], rotate: number): Promise<LiveFinding[]> {
  const key = config.liveData.exaApiKey;
  if (!key) return [];
  const angle = EXA_ANGLES[rotate % EXA_ANGLES.length]!;
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: angle,
        numResults: 8,
        type: "auto",
        category: "news",
        contents: { text: { maxCharacters: 400 } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{ title?: string; text?: string; url?: string }>;
    };
    const avoidSet = new Set(avoid.map((s) => s.toLowerCase()));
    const findings: LiveFinding[] = [];
    for (const r of data.results ?? []) {
      const subject = (r.title ?? "").trim();
      const fact = (r.text ?? "").replace(/\s+/g, " ").trim();
      if (!subject || fact.length < 40) continue;
      if (avoidSet.has(subject.toLowerCase())) continue;
      findings.push({ subject: subject.slice(0, 120), fact: fact.slice(0, 400) });
    }
    return findings;
  } catch {
    return [];
  }
}

/// Broad Firecrawl angles. Firecrawl can capture ANY page, so the topics range
/// well beyond crypto — prediction markets, AI, tech, science, sports, finance —
/// which is exactly what makes solver missions varied and interesting.
const FIRECRAWL_QUERIES = [
  "Polymarket trending prediction markets and their odds this week",
  "biggest movers and notable events in crypto markets today",
  "notable AI model releases, benchmarks, and research this month",
  "recent breakthroughs in technology and science in the news",
  "trending GitHub repositories and developer tools this week",
  "major world, sports, or cultural events happening right now",
  "notable stock market moves, earnings, and macro news this week",
  "an emerging trend or controversy people are debating online now",
];

/// Firecrawl search -> real findings from anywhere on the web. Title is the
/// subject, the description/snippet the fact. Filters anything in `avoid`.
async function firecrawlFindings(avoid: string[], rotate: number): Promise<LiveFinding[]> {
  const key = config.liveData.firecrawlApiKey;
  if (!key) return [];
  const query = FIRECRAWL_QUERIES[rotate % FIRECRAWL_QUERIES.length]!;
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 8 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: Array<{ title?: string; description?: string; markdown?: string; url?: string }>;
    };
    const avoidSet = new Set(avoid.map((s) => s.toLowerCase()));
    const findings: LiveFinding[] = [];
    for (const r of data.data ?? []) {
      const subject = (r.title ?? "").trim();
      const fact = (r.description ?? r.markdown ?? "").replace(/\s+/g, " ").trim();
      if (!subject || fact.length < 40) continue;
      if (avoidSet.has(subject.toLowerCase())) continue;
      findings.push({ subject: subject.slice(0, 120), fact: fact.slice(0, 400) });
    }
    return findings;
  } catch {
    return [];
  }
}

/// The Graph -> real on-chain stats. Queries the configured subgraph(s) (default
/// Uniswap v3) for the top pools by volume; each pool is a subject and its real
/// TVL / volume / fee / tx-count the ground-truth fact. Best for scout/analyst
/// missions, where the answer is literally on chain.
async function graphFindings(avoid: string[], rotate: number): Promise<LiveFinding[]> {
  const key = config.liveData.graphApiKey;
  const ids = config.liveData.graphSubgraphIds;
  if (!key || ids.length === 0) return [];
  const subgraphId = ids[rotate % ids.length]!;
  const gql = `{ pools(first: 12, orderBy: volumeUSD, orderDirection: desc, where: { volumeUSD_gt: "1000000" }) { token0 { symbol } token1 { symbol } feeTier totalValueLockedUSD volumeUSD txCount } }`;
  try {
    const res = await fetch(`https://gateway.thegraph.com/api/${key}/subgraphs/id/${subgraphId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: gql }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: {
        pools?: Array<{
          token0: { symbol: string };
          token1: { symbol: string };
          feeTier: string;
          totalValueLockedUSD: string;
          volumeUSD: string;
          txCount: string;
        }>;
      };
    };
    const avoidSet = new Set(avoid.map((s) => s.toLowerCase()));
    const usd = (v: string) => Math.round(Number(v) || 0).toLocaleString("en-US");
    const findings: LiveFinding[] = [];
    for (const p of data.data?.pools ?? []) {
      const subject = `${p.token0.symbol}/${p.token1.symbol} pool on Uniswap v3`;
      if (avoidSet.has(subject.toLowerCase())) continue;
      const fee = (Number(p.feeTier) || 0) / 10000;
      const fact = `Real onchain data: TVL $${usd(p.totalValueLockedUSD)}, lifetime volume $${usd(p.volumeUSD)}, ${fee}% fee tier, ${usd(p.txCount)} transactions.`;
      findings.push({ subject: subject.slice(0, 120), fact: fact.slice(0, 400) });
    }
    return findings;
  } catch {
    return [];
  }
}

/// DeFi Llama -> real protocol TVL and flow facts. Free, keyless, very reliable.
/// Each protocol is a subject and its live TVL plus 24h/7d change the ground
/// truth. Rotates the window across the top protocols so consecutive missions
/// probe different ground. CEX entries are filtered: missions are about DeFi.
async function llamaFindings(avoid: string[], rotate: number): Promise<LiveFinding[]> {
  try {
    const res = await fetch("https://api.llama.fi/protocols", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      name?: string;
      tvl?: number;
      change_1d?: number;
      change_7d?: number;
      category?: string;
      chain?: string;
    }>;
    const avoidSet = new Set(avoid.map((s) => s.toLowerCase()));
    const usd = (v: number) => Math.round(v).toLocaleString("en-US");
    const pct = (v: number | undefined) =>
      typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "n/a";
    const top = (data ?? []).filter(
      (p) => p.name && typeof p.tvl === "number" && p.tvl > 20_000_000 && p.category !== "CEX",
    ).slice(0, 60);
    const start = top.length > 0 ? rotate % top.length : 0;
    const rotated = [...top.slice(start), ...top.slice(0, start)];
    const findings: LiveFinding[] = [];
    for (const p of rotated) {
      const subject = `${p.name} (${p.category ?? "DeFi"})`;
      if (avoidSet.has(subject.toLowerCase())) continue;
      const fact =
        `Real DeFi data: TVL $${usd(p.tvl!)}, 24h ${pct(p.change_1d)}, 7d ${pct(p.change_7d)}` +
        `${p.chain ? `, primary chain ${p.chain}` : ""}.`;
      findings.push({ subject: subject.slice(0, 120), fact: fact.slice(0, 400) });
      if (findings.length >= 12) break;
    }
    return findings;
  } catch {
    return [];
  }
}

/// Polymarket -> live prediction-market implied odds. Free, keyless. Each open
/// market is a subject and its live YES price, volume, and resolve date the
/// ground truth — the exact answer a `market` fragment asks for, from the venue
/// that actually prices it. Sorted by volume so the markets are ones people
/// genuinely trade; rotated so consecutive missions probe different markets.
async function polymarketFindings(avoid: string[], rotate: number): Promise<LiveFinding[]> {
  try {
    const res = await fetch(
      "https://gamma-api.polymarket.com/markets?closed=false&order=volumeNum&ascending=false&limit=40",
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      question?: string;
      outcomePrices?: string;
      volumeNum?: number;
      volume?: string;
      endDate?: string;
    }>;
    const avoidSet = new Set(avoid.map((s) => s.toLowerCase()));
    const findings: LiveFinding[] = [];
    for (const m of data ?? []) {
      const subject = (m.question ?? "").trim();
      if (!subject || avoidSet.has(subject.toLowerCase())) continue;
      let yesPct: number | null = null;
      try {
        const prices = JSON.parse(m.outcomePrices ?? "[]") as string[];
        const p = Number(prices[0]);
        // Skip effectively-resolved extremes; a 0%/100% market teaches nothing.
        if (Number.isFinite(p) && p > 0.01 && p < 0.99) yesPct = Math.round(p * 100);
      } catch {
        /* market without a parseable price; skip it */
      }
      if (yesPct == null) continue;
      const volNum = Number(m.volumeNum ?? m.volume);
      const vol = Number.isFinite(volNum) ? `$${Math.round(volNum).toLocaleString("en-US")}` : "n/a";
      const ends = m.endDate ? new Date(m.endDate).toISOString().slice(0, 10) : "open";
      findings.push({
        subject: subject.slice(0, 120),
        fact: `Live Polymarket pricing: ${yesPct}% implied YES, volume ${vol}, resolves ${ends}.`.slice(0, 400),
      });
    }
    if (findings.length === 0) return [];
    const start = rotate % findings.length;
    return [...findings.slice(start), ...findings.slice(0, start)].slice(0, 12);
  } catch {
    return [];
  }
}

/// Picks findings for a mission, rotating across the available live sources for
/// variety. Returns the first source that yields enough findings, else the
/// richest. On-chain domains (scout/analyst) try The Graph first.
async function findingsForDomain(
  domain: string,
  avoid: string[],
  rotate: number,
  minNeeded: number,
): Promise<{ findings: LiveFinding[]; source: string }> {
  // Free sources first, rotated for variety: Exa and DeFi Llama for everything,
  // plus The Graph (on-chain ground truth) leading for scout/analyst. Firecrawl
  // is paid, so it stays out of this primary list.
  const free: Array<{ name: string; fn: (a: string[], r: number) => Promise<LiveFinding[]> }> = [
    { name: "exa", fn: exaFindings },
    { name: "llama", fn: llamaFindings },
  ];
  if (domain === "scout" || domain === "analyst") {
    free.unshift({ name: "graph", fn: graphFindings });
  }
  const off = rotate % free.length;
  const ordered = [...free.slice(off), ...free.slice(0, off)];
  let best: { findings: LiveFinding[]; source: string } = { findings: [], source: "none" };
  for (const s of ordered) {
    const findings = await s.fn(avoid, rotate);
    if (findings.length >= minNeeded) return { findings, source: s.name };
    if (findings.length > best.findings.length) best = { findings, source: s.name };
  }
  // Paid fallback: only reached when the free sources came up short, and only on
  // the allowed fraction of missions, so Firecrawl spend stays minimal.
  if (firecrawlAllowed(rotate)) {
    const findings = await firecrawlFindings(avoid, rotate);
    if (findings.length >= minNeeded) return { findings, source: "firecrawl" };
    if (findings.length > best.findings.length) best = { findings, source: "firecrawl" };
  }
  return best;
}

/// Builds a live-grounded mission for a template, or null to fall back.
/// Grounding is per kind: `market` fragments take live Polymarket odds, the rest
/// draw from the domain pool (Exa / Graph / Llama). Each side backfills from the
/// other when short, so a thin source degrades the mix instead of killing the
/// mission. Llama and Polymarket are keyless, so live grounding works even with
/// no API keys configured; a network failure just falls back to LLM/canned.
export async function buildLiveMission(template: MissionTemplate, avoid: string[]): Promise<BuiltLive | null> {
  const n = template.fragments.length;
  const rotate = avoid.length; // cheap deterministic-ish rotation, no Math.random

  const marketSlots = template.fragments.filter((f) => f.kind === "market").length;
  const generalNeeded = n - marketSlots;
  const [general, markets] = await Promise.all([
    generalNeeded > 0
      ? findingsForDomain(template.domain, avoid, rotate, generalNeeded)
      : Promise.resolve({ findings: [] as LiveFinding[], source: "none" }),
    marketSlots > 0 ? polymarketFindings(avoid, rotate) : Promise.resolve([] as LiveFinding[]),
  ]);

  // One finding per fragment, tagged with where it came from so the mission's
  // source label reads like the real sweep it was ("exa+polymarket").
  const generalQ = general.findings.map((f) => ({ f, src: general.source }));
  const marketQ = markets.map((f) => ({ f, src: "polymarket" }));
  const chosen: Array<{ f: LiveFinding; src: string }> = [];
  for (const tf of template.fragments) {
    const pick = tf.kind === "market" ? (marketQ.shift() ?? generalQ.shift()) : (generalQ.shift() ?? marketQ.shift());
    if (!pick) return null; // not enough live ground truth; fall back to LLM/canned
    chosen.push(pick);
  }

  // Subject fills the ask shell; the real fact is the ground-truth intel a
  // specialist sells / the operative must reflect 1:1.
  const subjects = chosen.map((c) => c.f.subject);
  const fragments = template.fragments.map((tf, i) => ({
    ask: tf.askShell.replace(/\{subject\}/g, subjects[i]!),
    intel: chosen[i]!.f.fact,
  }));
  const brief = template.briefShell.replace(/\{subjects\}/g, subjects.join(", "));
  const source = [...new Set(chosen.map((c) => c.src))].join("+");
  return { brief, fragments, subjects, source };
}
