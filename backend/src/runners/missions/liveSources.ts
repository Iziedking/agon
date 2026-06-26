import { config } from "../../config/index.js";
import type { MissionTemplate } from "./templates.js";

/// Live-data mission sources (v2 diversity). Each source pulls REAL current data
/// so missions are grounded in the world, educative to watch, and never repeat:
///   - Exa     -> recent web findings (research / solver subjects)
///   - Firecrawl-> Polymarket scrape (prediction / analyst subjects)   [next]
///   - Graph   -> on-chain stats (scout / analyst subjects)            [next]
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

/// Picks findings for a mission, rotating across the available live sources for
/// variety. Returns the first source that yields enough findings, else the
/// richest. Adding The Graph later is one more entry in `sources`.
async function findingsForDomain(
  domain: string,
  avoid: string[],
  rotate: number,
  minNeeded: number,
): Promise<{ findings: LiveFinding[]; source: string }> {
  const sources: Array<{ name: string; fn: (a: string[], r: number) => Promise<LiveFinding[]> }> = [
    { name: "exa", fn: exaFindings },
    { name: "firecrawl", fn: firecrawlFindings },
  ];
  // Rotate the start so consecutive missions favour different sources.
  const off = rotate % sources.length;
  const ordered = [...sources.slice(off), ...sources.slice(0, off)];
  let best: { findings: LiveFinding[]; source: string } = { findings: [], source: "none" };
  for (const s of ordered) {
    const findings = await s.fn(avoid, rotate);
    if (findings.length >= minNeeded) return { findings, source: s.name };
    if (findings.length > best.findings.length) best = { findings, source: s.name };
  }
  return best;
}

/// Builds a live-grounded mission for a template, or null to fall back.
export async function buildLiveMission(template: MissionTemplate, avoid: string[]): Promise<BuiltLive | null> {
  if (!config.liveData.exaApiKey && !config.liveData.firecrawlApiKey && !config.liveData.graphApiKey) {
    return null;
  }
  const n = template.fragments.length;
  const rotate = avoid.length; // cheap deterministic-ish rotation, no Math.random
  const { findings, source } = await findingsForDomain(template.domain, avoid, rotate, n);
  if (findings.length < n) return null;

  // One finding per fragment. Subject fills the ask shell; the real fact is the
  // ground-truth intel a specialist sells / the operative must reflect 1:1.
  const chosen = findings.slice(0, n);
  const subjects = chosen.map((f) => f.subject);
  const fragments = template.fragments.map((tf, i) => ({
    ask: tf.askShell.replace(/\{subject\}/g, subjects[i]!),
    intel: chosen[i]!.fact,
  }));
  const brief = template.briefShell.replace(/\{subjects\}/g, subjects.join(", "));
  return { brief, fragments, subjects, source };
}
