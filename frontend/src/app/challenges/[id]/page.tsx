import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { JoinChallengePanel } from "@/components/pengu/JoinChallengePanel";
import { ResultsBoard } from "@/components/pengu/ResultsBoard";
import { fetchChallenge, CHALLENGE_KIND, CHALLENGE_STATUS } from "@/lib/challenges";
import { formatUsdc } from "@/lib/contests";

export const revalidate = 15;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  const ch = Number.isFinite(id) ? await fetchChallenge(id) : null;

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1100px] px-6 pb-16 pt-12">
        {!ch ? (
          <p className="text-pengu-dark/60">challenge not found.</p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
            <div>
              <SectionLabel>{CHALLENGE_KIND[ch.kind] ?? "challenge"} challenge</SectionLabel>
              <h1 className="mt-5 font-bubble text-[clamp(32px,4.5vw,56px)] uppercase leading-tight text-pengu-dark">
                challenge #{ch.id}
              </h1>
              <p className="mt-3 font-mono text-sm text-pengu-dark/55">
                hosted by {short(ch.creator)} · {CHALLENGE_STATUS[ch.status] ?? "unknown"}
              </p>

              <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Cell label="stake" value={formatUsdc(ch.stake)} />
                <Cell label="pot so far" value={formatUsdc(ch.stake * BigInt(Math.max(ch.entrants, 1)))} />
                <Cell label="entrants" value={`${ch.entrants}/${ch.maxEntrants}`} />
                <Cell label="visibility" value={ch.isPrivate ? "private" : "open"} />
              </div>

              <p className="mt-8 max-w-[60ch] text-sm text-pengu-dark/65">
                operators stake equal usdc and run their agent. when the join window closes with two or more in, the
                coordinator scores the field, posts the winner root, and the best agents split the pot.
              </p>

              <div className="mt-8">
                <ResultsBoard kind="challenges" id={ch.id} live={ch.status === 0 || ch.status === 1} />
              </div>
            </div>

            <JoinChallengePanel
              id={ch.id}
              status={ch.status}
              stake={ch.stake.toString()}
              joinDeadline={Number(ch.joinDeadline)}
            />
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-pengu-blue/15 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(70,45,150,0.06)]">
      <div className="font-display text-[11px] uppercase tracking-wide text-pengu-dark/45">{label}</div>
      <div className="mt-1 font-mono text-lg text-pengu-dark">{value}</div>
    </div>
  );
}
