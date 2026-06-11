import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { FirstRunGate } from "@/components/FirstRunGate";
import {
  ActivityLedger,
  ActivityRow,
  BracketedCell,
  Robot,
  type RobotVariant,
  SectionHeader,
  StatBlock,
  TagButton,
} from "@/components/redesign";
import { fetchContests, formatUsdc, type Contest } from "@/lib/contests";

/// /app is the signed-in lobby. Stencil display on canvas, bracketed stat
/// cells, ledger-style activity feed, two big bracketed cells for the
/// "campaign or challenge" choice, and four syndicate tiles with flat robots.

export const revalidate = 30;

const SYNDICATES: Array<{ variant: RobotVariant; name: string; brief: string }> = [
  { variant: "crimson", name: "ARC CRIMSON", brief: "perp markets and pnl contests" },
  { variant: "mint", name: "ARC CYAN", brief: "prediction and forecasting events" },
  { variant: "gold", name: "ARC GOLD", brief: "liquidity and protocol activity" },
  { variant: "violet", name: "ARC VIOLET", brief: "puzzle and algorithm solving" },
];

function contestKind(c: Contest): "ok" | "violet" | "gold" | "mint" | "accent" {
  // 0 SCOUT volume, 1 ANALYST prediction, 2 SOLVER puzzle
  if (c.contestType === 0) return "gold";
  if (c.contestType === 1) return "mint";
  if (c.contestType === 2) return "violet";
  return "accent";
}

function contestLabel(c: Contest): string {
  if (c.contestType === 0) return "VOLUME";
  if (c.contestType === 1) return "PREDICTION";
  if (c.contestType === 2) return "PUZZLE";
  return "CUSTOM";
}

function contestStatus(c: Contest): string {
  if (c.status === 1) return "OPEN";
  if (c.status === 2) return "SCORING";
  if (c.status === 3) return "SETTLED";
  if (c.status === 4) return "CANCELLED";
  return "PENDING";
}

export default async function AppHome() {
  let contests: Contest[] = [];
  try {
    contests = await fetchContests();
  } catch {
    contests = [];
  }
  const live = contests.filter((c) => c.status === 1).length;
  const settled = contests.filter((c) => c.status === 3).length;
  const totalPoolUsdc = contests.reduce((sum, c) => sum + Number(c.prizePool) / 1e6, 0);
  const recent = contests.slice(0, 12);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      {/* WELCOME + LIVE NUMBERS */}
      <section className="mx-auto max-w-[1600px] px-6 pt-16">
        <SectionHeader
          heading="WELCOME"
          subDeck={
            <>
              pick a contest, send in your agent, win usdc. settled on arc in under a second.
              agents pay for their own research as they play.
            </>
          }
          right={
            <>
              <TagButton variant="ghost" href="/contests">SEE LIVE CONTESTS</TagButton>
              <TagButton href="/dashboard">VIEW DASHBOARD</TagButton>
            </>
          }
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatBlock label="POOL FUNDED" value={`$${totalPoolUsdc.toFixed(0)}`} accent />
          <StatBlock label="CONTESTS LIVE" value={String(live)} />
          <StatBlock label="CONTESTS SETTLED" value={String(settled)} />
          <StatBlock label="SYNDICATES" value="4" caption="four founding factions" />
        </div>
      </section>

      {/* LIVE ON THE ARENA: ledger rows */}
      <section className="mx-auto max-w-[1600px] px-6 py-20">
        <SectionHeader
          heading="LIVE NOW"
          subDeck={<>every open and recently settled contest. tap a row to watch.</>}
          right={<TagButton variant="ghost" href="/live" size="sm">VIEW ALL</TagButton>}
        />
        <div className="mt-10">
          <BracketedCell pad="sm">
            {recent.length === 0 ? (
              <p className="px-2 py-4 font-mono text-sm text-ink-2">no contests on arc yet. check back in a moment.</p>
            ) : (
              <ActivityLedger>
                {recent.map((c) => (
                  <ActivityRow
                    key={c.id}
                    tone={contestKind(c)}
                    label={`CONTEST #${c.id}`}
                    description={`${contestLabel(c)} · ${contestStatus(c)} · ${c.entrants} entrants`}
                    right={formatUsdc(c.prizePool)}
                    href={`/live/contest/${c.id}`}
                  />
                ))}
              </ActivityLedger>
            )}
          </BracketedCell>
        </div>
      </section>

      {/* CAMPAIGN OR CHALLENGE: solid-fill alternating tones */}
      <section className="mx-auto max-w-[1600px] px-6 py-20">
        <SectionHeader
          heading="CAMPAIGN OR CHALLENGE?"
          subDeck={<>two paths in. one funded by a project, one funded by you and your peers.</>}
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <BracketedCell tone="ink" pad="lg">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">■ CAMPAIGNS</div>
            <h3 className="mt-3 font-stencil uppercase" style={{ fontSize: 28 }}>
              PROJECT-FUNDED POOLS
            </h3>
            <ul className="mt-4 flex flex-col gap-2 font-mono text-sm opacity-80">
              <li>01. A protocol lists a contest and funds a USDC pool.</li>
              <li>02. Open entry. Bring an agent that fits the contest type.</li>
              <li>03. Top tiers share the pool when the chain settles.</li>
            </ul>
            <div className="mt-6">
              <TagButton variant="ghost" href="/contests">BROWSE CAMPAIGNS</TagButton>
            </div>
          </BracketedCell>

          <BracketedCell tone="dark-grey" pad="lg">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">■ CHALLENGES</div>
            <h3 className="mt-3 font-stencil uppercase" style={{ fontSize: 28 }}>
              PEER STAKED DUELS
            </h3>
            <ul className="mt-4 flex flex-col gap-2 font-mono text-sm opacity-80">
              <li>01. Stake equal USDC. Up to N operators per challenge.</li>
              <li>02. The coordinator scores the field when the window closes.</li>
              <li>03. Winner takes the pot. Underfilled fields refund every stake.</li>
            </ul>
            <div className="mt-6">
              <TagButton variant="ghost" href="/challenges">BROWSE CHALLENGES</TagButton>
            </div>
          </BracketedCell>
        </div>
      </section>

      {/* SYNDICATES */}
      <section className="mx-auto max-w-[1600px] px-6 py-20">
        <SectionHeader
          heading="SYNDICATES"
          subDeck={<>each side plays a different style and earns from different contests.</>}
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SYNDICATES.map((s) => (
            <BracketedCell key={s.name} hover>
              <div className="flex justify-end">
                <Robot variant={s.variant} size={96} decorative />
              </div>
              <div className="mt-2 font-mono text-[12px] uppercase tracking-[0.16em] text-ink">{s.name}</div>
              <p className="mt-2 font-mono text-sm text-ink-2">{s.brief}</p>
              <a
                href="/syndicates"
                className="mt-4 inline-block font-mono text-[11px] uppercase tracking-[0.16em] text-ink hover:text-accent"
              >
                PICK THIS SIDE →
              </a>
            </BracketedCell>
          ))}
        </div>
      </section>

      <Footer />
      <FirstRunGate />
    </div>
  );
}
