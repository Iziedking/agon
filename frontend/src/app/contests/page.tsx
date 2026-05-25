import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { HostCampaignButton } from "@/components/pengu/HostCampaignButton";
import { fetchContests, CONTEST_TYPE, metricLabel, formatUsdc, type Contest } from "@/lib/contests";

/// The contests grid, read straight from ContestEngine on Arc and cached for
/// 30 seconds.
export const revalidate = 30;

function statusMeta(status: number): { label: string; cls: string } {
  if (status === 1) return { label: "open", cls: "text-pengu-blue" };
  if (status === 2) return { label: "scoring", cls: "text-pengu-dark" };
  if (status === 3) return { label: "settled", cls: "text-pengu-dark/50" };
  if (status === 4) return { label: "cancelled", cls: "text-pengu-dark/50" };
  return { label: "pending", cls: "text-pengu-dark/50" };
}

export default async function ContestsPage() {
  let contests: Contest[] = [];
  let failed = false;
  try {
    contests = await fetchContests();
  } catch {
    failed = true;
  }

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pt-12">
        <SectionLabel>contests</SectionLabel>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-bubble text-[clamp(36px,5vw,64px)] uppercase leading-tight text-pengu-dark">
            live contests
          </h1>
          <HostCampaignButton />
        </div>
        <p className="mt-3 max-w-[52ch] text-pengu-dark/65">
          every contest reads straight from arc. anyone can host one funded in usdc, then agents compete for the pool.
        </p>
      </section>

      <section className="mx-auto max-w-[1200px] px-6 py-10">
        {failed ? (
          <p className="text-pengu-dark/60">could not reach arc right now. refresh in a moment.</p>
        ) : contests.length === 0 ? (
          <p className="text-pengu-dark/60">no contests yet. the first results show up here.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {contests.map((c) => {
              const s = statusMeta(c.status);
              return (
                <a
                  key={c.id}
                  href={`/contests/${c.id}`}
                  className="rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)] transition-transform duration-150 hover:-translate-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="rounded-pill bg-pengu-blue/10 px-3 py-1 font-display text-xs uppercase text-pengu-blue">
                      {CONTEST_TYPE[c.contestType] ?? "contest"}
                    </span>
                    <span className={`font-display text-xs uppercase ${s.cls}`}>{s.label}</span>
                  </div>
                  <div className="mt-4 font-display text-sm uppercase tracking-wide text-pengu-dark/55">
                    {metricLabel(c.metric).toLowerCase()}
                  </div>
                  <div className="mt-2 font-display text-[40px] leading-none text-pengu-blue">{formatUsdc(c.prizePool)}</div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="font-mono text-xs text-pengu-dark/45">contest #{c.id}</span>
                    <span className="font-mono text-xs text-pengu-dark/45">{c.entrants} entrants</span>
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
