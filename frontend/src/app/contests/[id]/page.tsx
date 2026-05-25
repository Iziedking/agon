import type { ReactNode } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/pengu/Footer";
import { SectionLabel } from "@/components/pengu/atoms";
import { Countdown } from "@/components/pengu/Countdown";
import { EnterPanel } from "@/components/pengu/EnterPanel";
import { ResultsBoard } from "@/components/pengu/ResultsBoard";
import { CONTRACTS, EXPLORER } from "@/lib/arc";
import { CONTEST_TYPE, fetchContest, formatUsdc, metricLabel, type Contest } from "@/lib/contests";

export const revalidate = 30;

const ZERO = "0x0000000000000000000000000000000000000000";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function statusMeta(status: number): { label: string; cls: string } {
  if (status === 1) return { label: "open", cls: "text-pengu-blue" };
  if (status === 2) return { label: "scoring", cls: "text-pengu-dark" };
  if (status === 3) return { label: "settled", cls: "text-pengu-dark/50" };
  if (status === 4) return { label: "cancelled", cls: "text-pengu-dark/50" };
  return { label: "pending", cls: "text-pengu-dark/50" };
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-pengu-blue/10 py-3 last:border-0">
      <span className="font-display text-xs uppercase tracking-wide text-pengu-dark/45">{k}</span>
      <span className="font-mono text-sm text-pengu-dark">{children}</span>
    </div>
  );
}

export default async function ContestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = Number(id);
  let c: Contest | null = null;
  if (Number.isFinite(nid)) {
    try {
      c = await fetchContest(nid);
    } catch {
      c = null;
    }
  }
  const s = c ? statusMeta(c.status) : null;

  return (
    <div className="min-h-screen text-pengu-dark" style={{ background: "#f3effb" }}>
      <AppHeader />

      <section className="mx-auto max-w-[1200px] px-6 pb-16 pt-12">
        <a href="/contests" className="font-display text-xs uppercase tracking-wide text-pengu-blue">
          all contests
        </a>

        {!c || !s ? (
          <div className="mt-8 rounded-card border border-pengu-blue/15 bg-white p-8 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
            <h1 className="font-bubble text-2xl uppercase text-pengu-dark">contest not found</h1>
            <p className="mt-2 text-pengu-dark/65">contest #{id} is not on arc yet.</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                <SectionLabel>
                  {CONTEST_TYPE[c.contestType] ?? "contest"} · #{c.id}
                </SectionLabel>
                <span className={`font-display text-xs uppercase ${s.cls}`}>{s.label}</span>
              </div>

              <div className="mt-5 font-bubble text-[clamp(48px,8vw,92px)] leading-none text-pengu-blue">
                {formatUsdc(c.prizePool)}
              </div>
              <p className="mt-3 font-mono text-sm text-pengu-dark/55">
                prize pool · <Countdown endTime={Number(c.endTime)} status={c.status} />
              </p>

              <div className="mt-8 rounded-card border border-pengu-blue/15 bg-white p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
                <Row k="metric">{metricLabel(c.metric).toLowerCase()}</Row>
                <Row k="entrants">{c.entrants}</Row>
                <Row k="headline winners">{c.topN}</Row>
                <Row k="winner cut">{(c.winnerCutBps / 100).toFixed(0)}%</Row>
                <Row k="platform fee">{(c.platformFeeBps / 100).toFixed(1)}%</Row>
                <Row k="sponsor">
                  <a href={`${EXPLORER}/address/${c.sponsor}`} target="_blank" rel="noreferrer" className="text-pengu-blue">
                    {short(c.sponsor)}
                  </a>
                </Row>
                {c.protocolTarget !== ZERO ? (
                  <Row k="protocol target">
                    <a
                      href={`${EXPLORER}/address/${c.protocolTarget}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-pengu-blue"
                    >
                      {short(c.protocolTarget)}
                    </a>
                  </Row>
                ) : null}
              </div>

              <p className="mt-4">
                <a
                  href={`${EXPLORER}/address/${CONTRACTS.ContestEngine}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-pengu-dark/45 hover:text-pengu-blue"
                >
                  view contestengine on arcscan ↗
                </a>
              </p>

              <div className="mt-6">
                <ResultsBoard kind="contests" id={c.id} live={c.status === 1 || c.status === 2} />
              </div>
            </div>

            <aside className="lg:col-span-1">
              <EnterPanel contestId={c.id} status={c.status} endTime={Number(c.endTime)} />
            </aside>
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}
