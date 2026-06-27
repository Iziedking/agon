/// Shared loader for the win-share route. Both the page metadata and the OG
/// image read the same data: the operator's placement in a settled event plus
/// their display identity (handle + avatar) for the card. All fetches are
/// best-effort; a miss degrades to a clean generic card rather than failing.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export interface WinData {
  /// "contest" | "challenge", normalized.
  source: "contest" | "challenge";
  kindLabel: string; // "contest" | "challenge" | "mission" for prose
  /// True when this "contest" is actually a mission (missions ride a contest, so
  /// the share link still carries source=contest). Drives the MISSION label.
  isMission: boolean;
  /// Composed display label for the card and unfurl, e.g. "MISSION 021",
  /// "CONTEST #123", "CHALLENGE #123". Missions use their display sequence.
  eventLabel: string;
  id: string;
  rank: number | null;
  amount6: string | null; // USDC 6-dec as a string, null if not a winner
  handle: string | null; // @x / discord / @telegram, null if none linked
  avatarUrl: string | null; // resolved pfp URL, null to draw a placeholder
  short: string; // masked wallet
}

export function formatUsdc6(amount6: string | null): string | null {
  if (amount6 == null) return null;
  const n = Number(amount6) / 1e6;
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(2)} USDC`;
}

export function placeVerb(rank: number | null): string {
  if (rank === 1) return "Won";
  if (rank === 2) return "Took 2nd in";
  if (rank === 3) return "Took 3rd in";
  if (rank && rank > 0) return `Placed #${rank} in`;
  return "Competed in";
}

export async function loadWin(sourceRaw: string, id: string, op: string): Promise<WinData> {
  const source: "contest" | "challenge" = sourceRaw === "challenge" ? "challenge" : "contest";
  const kind = source === "challenge" ? "challenges" : "contests";
  const opLower = op.toLowerCase();

  // Tight timeout: this runs inside the social crawler's fetch of the OG
  // image. If the backend is slow the card must still render (degraded), or
  // the crawler times out and shows no card at all.
  const t = () => AbortSignal.timeout(2500);

  let rank: number | null = null;
  let amount6: string | null = null;
  // A contest may actually be a mission (missions ride a solver contest). Probe
  // the mission read CONCURRENTLY with results so the extra hop adds no latency
  // to the crawler's fetch; on any miss we fall back to the plain contest label.
  let isMission = false;
  let missionSeq = 0;
  try {
    const [resultsRes, missionRes] = await Promise.all([
      fetch(`${AUTH_URL}/${kind}/${id}/results`, { cache: "no-store", signal: t() }),
      source === "contest"
        ? fetch(`${AUTH_URL}/missions/${id}`, { cache: "no-store", signal: t() }).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (resultsRes.ok) {
      const data = (await resultsRes.json()) as { winners?: Array<{ rank: number; operator: string; amount: string }> };
      const w = (data.winners ?? []).find((x) => x.operator.toLowerCase() === opLower);
      if (w) {
        rank = w.rank;
        amount6 = w.amount;
      }
    }
    if (missionRes && missionRes.ok) {
      const md = (await missionRes.json()) as { mission?: { seq?: number } | null };
      if (md.mission) {
        isMission = true;
        missionSeq = Number(md.mission.seq) || 0;
      }
    }
  } catch {
    /* generic card */
  }

  let handle: string | null = null;
  let avatarUrl: string | null = null;
  try {
    const res = await fetch(`${AUTH_URL}/operators/${opLower}`, { cache: "no-store", signal: t() });
    if (res.ok) {
      const p = (await res.json()) as {
        xHandle?: string | null;
        discordUsername?: string | null;
        discordAvatar?: string | null;
        telegramUsername?: string | null;
        telegramAvatar?: string | null;
      };
      if (p.xHandle) {
        handle = `@${p.xHandle}`;
        avatarUrl = `https://unavatar.io/x/${p.xHandle}`;
      } else if (p.discordUsername) {
        handle = p.discordUsername;
        avatarUrl = p.discordAvatar ?? p.telegramAvatar ?? null;
      } else if (p.telegramUsername) {
        handle = `@${p.telegramUsername}`;
        // Prefer the pfp we captured through the Bot API (a data URL) over the
        // unavatar.io scrape, which is blank for most Telegram users.
        avatarUrl = p.telegramAvatar ?? `https://unavatar.io/telegram/${p.telegramUsername}`;
      }
    }
  } catch {
    /* draw placeholder */
  }

  const kindLabel = source === "challenge" ? "challenge" : isMission ? "mission" : "contest";
  const eventLabel = isMission
    ? `MISSION ${String(missionSeq > 0 ? missionSeq : Number(id) || 0).padStart(3, "0")}`
    : `${kindLabel.toUpperCase()} #${id}`;

  return {
    source,
    kindLabel,
    isMission,
    eventLabel,
    id,
    rank,
    amount6,
    handle,
    avatarUrl,
    short: `${op.slice(0, 6)}…${op.slice(-4)}`,
  };
}
