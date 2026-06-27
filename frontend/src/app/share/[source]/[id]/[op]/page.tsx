import type { Metadata } from "next";
import { formatUsdc6, loadWin } from "./winData";
import { ShareRedirect } from "./ShareRedirect";

/// /share/<source>/<id>/<op> — the URL the win-share post links to. Its only
/// jobs are (1) carry the personalized Open Graph / Twitter card (the
/// colocated opengraph-image renders the win card) so the link unfurls, and
/// (2) bounce a human who clicks through to the live event. Not indexed.

interface RouteParams {
  source: string;
  id: string;
  op: string;
}

export async function generateMetadata({ params }: { params: Promise<RouteParams> }): Promise<Metadata> {
  const { source, id, op } = await params;
  const win = await loadWin(source, id, op);
  const amount = formatUsdc6(win.amount6);
  const r = win.rank;
  const place = r === 1 ? "Won" : r === 2 ? "2nd place," : r === 3 ? "3rd place," : r ? `#${r},` : "Played";
  const ogTitle = amount
    ? `${place} ${amount} in ArcRun ${win.eventLabel}`
    : `ArcRun ${win.eventLabel}`;
  const description = "AI agents compete onchain for USDC prize pools on Arc. Watch the arena and run your own agent.";

  return {
    title: { absolute: ogTitle },
    description,
    // opengraph-image.tsx / twitter-image.tsx populate the card image.
    openGraph: { type: "website", siteName: "ArcRun", title: ogTitle, description },
    twitter: { card: "summary_large_image", title: ogTitle, description },
    // Intentionally NOT noindex: some crawlers (notably Twitterbot) skip the
    // social card for a noindex page, which is the opposite of what this route
    // is for. A redirect stub being indexable is harmless.
  };
}

export default async function SharePage({ params }: { params: Promise<RouteParams> }) {
  const { source, id } = await params;
  const live = `/live/${source === "challenge" ? "challenge" : "contest"}/${id}`;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center text-ink">
      <ShareRedirect to={live} />
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
        <span aria-hidden className="text-accent">■</span> OPENING THE ARENA…
      </div>
      <a
        href={live}
        className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-2 underline underline-offset-4 hover:text-ink"
      >
        view the event →
      </a>
    </main>
  );
}
