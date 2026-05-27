import { EXPLORER } from "@/lib/arc";
import { formatUsdcString, short } from "@/lib/profiles";

/// The arena activity feed: recent on-chain events read from the auth service,
/// each turned into a one-line entry with an in-app link and an arcscan tx link.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export interface ActivityEvent {
  type: string;
  args: Record<string, unknown>;
  txHash: string;
  block: number;
}

export interface ActivityLine {
  label: string;
  text: string;
  href: string;
}

export const txLink = (hash: string) => `${EXPLORER}/tx/${hash}`;

export async function fetchActivity(limit = 30): Promise<ActivityEvent[]> {
  try {
    const res = await fetch(`${AUTH_URL}/activity?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { events?: ActivityEvent[] };
    return data.events ?? [];
  } catch {
    return [];
  }
}

const str = (v: unknown) => (v == null ? "" : String(v));
const usdc = (v: unknown) => formatUsdcString(str(v) || "0");
const who = (v: unknown) => short(str(v));

/// Turn a raw event into a feed entry: a short label, a human sentence, and where
/// in the app it points. Unknown events fall back to their name and the tx link.
export function describeActivity(ev: ActivityEvent): ActivityLine {
  const a = ev.args;
  switch (ev.type) {
    case "ContestListed":
      return { label: "campaign", text: `contest #${str(a.id)} listed · ${usdc(a.prizePool)} pool`, href: `/live/contest/${str(a.id)}` };
    case "EntryRegistered":
      return { label: "entered", text: `${who(a.operator)} entered contest #${str(a.contestId)}`, href: `/live/contest/${str(a.contestId)}` };
    case "ContestSettled":
      return { label: "settled", text: `contest #${str(a.contestId)} settled · ${usdc(a.paidOut)} paid out`, href: `/live/contest/${str(a.contestId)}` };
    case "ContestCancelled":
      return { label: "cancelled", text: `contest #${str(a.contestId)} cancelled`, href: `/live/contest/${str(a.contestId)}` };
    case "PrizeClaimed":
      return { label: "claimed", text: `${who(a.operator)} claimed ${usdc(a.amount)} from contest #${str(a.contestId)}`, href: `/operators/${str(a.operator)}` };
    case "ChallengeCreated":
      return { label: "challenge", text: `${who(a.creator)} opened challenge #${str(a.id)} · ${usdc(a.stake)} stake`, href: `/live/challenge/${str(a.id)}` };
    case "ChallengeJoined":
      return { label: "joined", text: `${who(a.operator)} joined challenge #${str(a.id)}`, href: `/live/challenge/${str(a.id)}` };
    case "ChallengeSettled":
      return { label: "settled", text: `challenge #${str(a.id)} settled`, href: `/live/challenge/${str(a.id)}` };
    case "ChallengeCancelled":
      return { label: "cancelled", text: `challenge #${str(a.id)} cancelled`, href: `/live/challenge/${str(a.id)}` };
    case "AgentCreated":
      return { label: "agent", text: `${who(a.owner)} claimed agent #${str(a.agentId)}`, href: `/operators/${str(a.owner)}` };
    default:
      return { label: "event", text: ev.type, href: txLink(ev.txHash) };
  }
}
