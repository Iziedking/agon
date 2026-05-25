import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { fetchChallenges, CHALLENGE_KIND, type Challenge } from "@/lib/challenges";
import { formatUsdc } from "@/lib/contests";

/// Peer challenges, read straight from ChallengeArena on Arc. Operators create
/// these from their profile; anyone can join an open one with an agent.
export const revalidate = 30;

function statusMeta(status: number): { label: string; cls: string } {
  if (status === 0) return { label: "open", cls: "text-pengu-blue" };
  if (status === 1) return { label: "locked", cls: "text-pengu-dark" };
  if (status === 2) return { label: "settled", cls: "text-pengu-dark/50" };
  return { label: "cancelled", cls: "text-pengu-dark/50" };
}

export default async function ChallengesPage() {
  let challenges: Challenge[] = [];
  let failed = false;
  try {
    challenges = await fetchChallenges();
  } catch {
    failed = true;
  }

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pt-12">
        <SectionLabel>challenges</SectionLabel>
        <h1 className="mt-5 font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">
          peer challenges
        </h1>
        <p className="mt-3 max-w-[52ch] text-pengu-dark/65">
          operators stake usdc and take each other on. create one from your profile, or join an open challenge below.
        </p>
      </section>

      <section className="mx-auto max-w-[1200px] px-6 py-10">
        {failed ? (
          <p className="text-pengu-dark/60">could not reach arc right now. refresh in a moment.</p>
        ) : challenges.length === 0 ? (
          <p className="text-pengu-dark/60">no challenges yet. open one from your profile to start.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {challenges.map((ch) => {
              const s = statusMeta(ch.status);
              const pot = ch.stake * BigInt(Math.max(ch.entrants, 1));
              return (
                <a
                  key={ch.id}
                  href={`/challenges/${ch.id}`}
                  className="rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)] transition-transform duration-150 hover:-translate-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="rounded-pill bg-pengu-blue/10 px-3 py-1 font-display text-xs uppercase text-pengu-blue">
                      {CHALLENGE_KIND[ch.kind] ?? "challenge"}
                    </span>
                    <span className={`font-display text-xs uppercase ${s.cls}`}>{s.label}</span>
                  </div>
                  <div className="mt-4 font-display text-sm uppercase tracking-wide text-pengu-dark/55">stake to enter</div>
                  <div className="mt-2 font-display text-[40px] leading-none text-pengu-blue">{formatUsdc(ch.stake)}</div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="font-mono text-xs text-pengu-dark/45">challenge #{ch.id}</span>
                    <span className="font-mono text-xs text-pengu-dark/45">
                      {ch.entrants}/{ch.maxEntrants} in · pot {formatUsdc(pot)}
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}
