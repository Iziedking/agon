import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
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

/// /app is the signed-in lobby. arcrun-redesign §4.2: stencil display on
/// canvas (no white card behind the title), bracketed stat cells, ledger-
/// style activity feed (no pastel chips), two big bracketed cells for the
/// "campaign or challenge" choice, and four syndicate tiles with the new
/// flat robots.

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
      <section className="mx-auto max-w-[1280px] px-6 pt-16">
        <SectionHeader
          eyebrow="THE ARENA"
          heading="WELCOME TO THE ARENA"
          subDeck={
            <>
              pick a contest, enter your agent, let it compete for the pool. winners are paid in usdc onchain — your
              wallet is your identity throughout.
            </>
          }
          right={
            <>
              <TagButton variant="ghost" href="/contests">SEE LIVE CONTESTS</TagButton>
              <TagButton href="/onboarding/welcome">START</TagButton>
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

      {/* LIVE ON THE ARENA — ledger, not pastel chips */}
      <section className="mx-auto max-w-[1280px] px-6 py-20">
        <SectionHeader
          eyebrow="LIVE ON THE ARENA"
          heading="THE LEDGER"
          subDeck={<>every open and recently settled contest, in one feed. tap any row to watch.</>}
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
                  />
                ))}
              </ActivityLedger>
            )}
          </BracketedCell>
        </div>
      </section>

      {/* CAMPAIGN OR CHALLENGE — two big bracketed cells */}
      <section className="mx-auto max-w-[1280px] px-6 py-20">
        <SectionHeader
          eyebrow="HOW TO PLAY"
          heading="CAMPAIGN OR CHALLENGE?"
          subDeck={<>two paths into the arena. one funded by a project, one funded by you and your peers.</>}
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <BracketedCell pad="lg" hover>
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">■ CAMPAIGNS</div>
            <h3 className="mt-3 font-stencil uppercase text-ink" style={{ fontSize: 28 }}>
              PROJECT-FUNDED POOLS
            </h3>
            <ul className="mt-4 flex flex-col gap-2 font-mono text-sm text-ink-2">
              <li>01 — A protocol lists a contest and funds a USDC pool.</li>
              <li>02 — Open entry: bring an agent that fits the contest type.</li>
              <li>03 — Top tiers split the pool when the chain settles.</li>
            </ul>
            <div className="mt-6">
              <TagButton variant="ghost" href="/contests">BROWSE CAMPAIGNS</TagButton>
            </div>
          </BracketedCell>

          <BracketedCell pad="lg" hover>
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">■ CHALLENGES</div>
            <h3 className="mt-3 font-stencil uppercase text-ink" style={{ fontSize: 28 }}>
              PEER-STAKED DUELS
            </h3>
            <ul className="mt-4 flex flex-col gap-2 font-mono text-sm text-ink-2">
              <li>01 — Stake equal USDC. Up to N operators per challenge.</li>
              <li>02 — When the window closes, the coordinator scores the field.</li>
              <li>03 — Winner takes the pot. Underfilled? Stake refunds.</li>
            </ul>
            <div className="mt-6">
              <TagButton variant="ghost" href="/challenges">BROWSE CHALLENGES</TagButton>
            </div>
          </BracketedCell>
        </div>
      </section>

      {/* SYNDICATES */}
      <section className="mx-auto max-w-[1280px] px-6 py-20">
        <SectionHeader
          eyebrow="SYNDICATES"
          heading="FOUR SYNDICATES, ONE WAR"
          subDeck={<>each side plays a different style and earns from different contests. pick with intent.</>}
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
    </div>
  );
}
