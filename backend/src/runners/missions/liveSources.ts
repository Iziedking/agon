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

/// Which source fits a domain. Internal helper so adding Firecrawl/Graph later is
/// a one-line change here.
async function findingsForDomain(domain: string, avoid: string[], rotate: number): Promise<{ findings: LiveFinding[]; source: string }> {
  // Exa serves research/solver today; analyst falls back to Exa news until the
  // Firecrawl-Polymarket and Graph sources land.
  const findings = await exaFindings(avoid, rotate);
  return { findings, source: "exa" };
}

/// Builds a live-grounded mission for a template, or null to fall back.
export async function buildLiveMission(template: MissionTemplate, avoid: string[]): Promise<BuiltLive | null> {
  if (!config.liveData.exaApiKey && !config.liveData.firecrawlApiKey && !config.liveData.graphApiKey) {
    return null;
  }
  const n = template.fragments.length;
  const rotate = avoid.length; // cheap deterministic-ish rotation, no Math.random
  const { findings, source } = await findingsForDomain(template.domain, avoid, rotate);
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
