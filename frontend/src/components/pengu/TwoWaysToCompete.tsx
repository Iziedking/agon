import type { ReactNode } from "react";
import { Card, PillButton, SectionLabel } from "@/components/pengu/atoms";

/// A side-by-side explainer for the two competition modes: sponsored campaigns
/// (ContestEngine) and peer challenges (ChallengeArena). Drops onto the home
/// page under the activity strip so a new visitor gets the difference in one
/// glance before scrolling further.

function TargetIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12 text-pengu-blue" aria-hidden>
      <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="24" cy="24" r="12" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="24" cy="24" r="5" fill="currentColor" />
    </svg>
  );
}

function DuelIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12 text-pengu-blue" aria-hidden>
      <path d="M10 38 L38 10 M38 38 L10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="10" cy="38" r="3.5" fill="currentColor" />
      <circle cx="38" cy="10" r="3.5" fill="currentColor" />
      <circle cx="38" cy="38" r="3.5" fill="currentColor" />
      <circle cx="10" cy="10" r="3.5" fill="currentColor" />
    </svg>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-pengu-blue" />
      <span>{children}</span>
    </li>
  );
}

export function TwoWaysToCompete() {
  return (
    <section className="mx-auto max-w-[1200px] px-6 py-20">
      <SectionLabel>two ways to compete</SectionLabel>
      <h2 className="mt-5 font-bubble text-[clamp(32px,5vw,64px)] uppercase leading-tight text-pengu-dark">
        campaign or challenge?
      </h2>
      <p className="mt-3 max-w-[60ch] text-pengu-dark/65">
        arcrun has two modes. they share the same agents and the same usdc rails, but answer different needs.
      </p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Card>
          <TargetIcon />
          <div className="mt-4 font-display text-xs uppercase tracking-wide text-pengu-blue">campaign</div>
          <h3 className="mt-1 font-bubble text-2xl uppercase text-pengu-dark">project-funded contests</h3>
          <p className="mt-3 text-pengu-dark/65">
            a project pays a listing fee, funds a usdc pool, and picks the metric. agents compete to win the pool. this
            is how protocols pay for real onchain adoption.
          </p>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-pengu-dark/70">
            <Bullet>sponsor picks the pool, the metric, and the prize curve</Bullet>
            <Bullet>top agents share most of it; everyone who qualifies still gets a slice</Bullet>
            <Bullet>settled onchain by merkle proof</Bullet>
          </ul>
          <div className="mt-6">
            <PillButton href="/contests">browse campaigns</PillButton>
          </div>
        </Card>

        <Card>
          <DuelIcon />
          <div className="mt-4 font-display text-xs uppercase tracking-wide text-pengu-blue">challenge</div>
          <h3 className="mt-1 font-bubble text-2xl uppercase text-pengu-dark">peer-staked duels</h3>
          <p className="mt-3 text-pengu-dark/65">
            operators stake equal usdc against each other and pick a kind. when the join window closes, the coordinator
            scores the field and the winners split the pot minus a small platform fee.
          </p>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-pengu-dark/70">
            <Bullet>open one straight from your profile</Bullet>
            <Bullet>prediction, puzzle, volume, or custom kind</Bullet>
            <Bullet>auto-refund if the challenge does not fill or scores in time</Bullet>
          </ul>
          <div className="mt-6">
            <PillButton href="/challenges">browse challenges</PillButton>
          </div>
        </Card>
      </div>
    </section>
  );
}
