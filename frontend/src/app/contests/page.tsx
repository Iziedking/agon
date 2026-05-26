import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { HostCampaignButton } from "@/components/pengu/HostCampaignButton";
import { ArenaCard, type ArenaState } from "@/components/pengu/ArenaCard";
import { Pagination } from "@/components/pengu/Pagination";
import { fetchContests, CONTEST_TYPE, metricLabel, formatUsdc, type Contest } from "@/lib/contests";

const PER_PAGE = 12;

/// The contests grid, read straight from ContestEngine on Arc and cached for
/// 30 seconds.
export const revalidate = 30;

function contestState(status: number): { state: ArenaState; label: string } {
  if (status === 1) return { state: "open", label: "open" };
  if (status === 2) return { state: "active", label: "scoring" };
  if (status === 3) return { state: "settled", label: "settled" };
  if (status === 4) return { state: "cancelled", label: "cancelled" };
  return { state: "active", label: "pending" };
}

export default async function ContestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const requested = Math.max(1, Number(sp.page ?? "1"));

  let contests: Contest[] = [];
  let failed = false;
  try {
    contests = await fetchContests();
  } catch {
    failed = true;
  }

  const total = contests.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(requested, totalPages);
  const pageItems = contests.slice((page - 1) * PER_PAGE, page * PER_PAGE);

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
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pageItems.map((c) => {
                const s = contestState(c.status);
                return (
                  <ArenaCard
                    key={c.id}
                    href={`/contests/${c.id}`}
                    kind={CONTEST_TYPE[c.contestType] ?? "contest"}
                    state={s.state}
                    stateLabel={s.label}
                    metric={metricLabel(c.metric).toLowerCase()}
                    prizeLabel="prize pool"
                    prize={formatUsdc(c.prizePool)}
                    startSec={Number(c.startTime)}
                    endSec={Number(c.endTime)}
                    footerLeft={`contest #${c.id}`}
                    footerRight={`${c.entrants} entrants`}
                  />
                );
              })}
            </div>
            <Pagination page={page} totalPages={totalPages} basePath="/contests" />
          </>
        )}
      </section>

      <Footer />
    </div>
  );
}
