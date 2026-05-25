"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ConnectButton } from "@/components/ConnectButton";
import { CONTRACTS, EXPLORER } from "@/lib/arc";
import {
  CONTEST_STATUS,
  CONTEST_TYPE,
  fetchContest,
  formatUsdc,
  metricLabel,
  statusClass,
  type Contest,
} from "@/lib/contests";

function timeInfo(c: Contest): string {
  if (c.status >= 2) return "ended";
  const left = Number(c.endTime) - Math.floor(Date.now() / 1000);
  if (left <= 0) return "entry window closed";
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  return `${h}h ${m}m left`;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function ContestDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [c, setC] = useState<Contest | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) {
      setC(null);
      return;
    }
    fetchContest(id)
      .then(setC)
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load"));
  }, [id]);

  return (
    <div className="wrap">
      <nav className="nav">
        <a className="wordmark" href="/">
          Arc<span>Run</span>
        </a>
        <div className="nav-links">
          <a href="/contests">All contests</a>
          <ConnectButton />
        </div>
      </nav>

      <div className="login">
        {error ? <div className="mono err">{error}</div> : null}
        {c === undefined && !error ? <div className="mono muted">loading from Arc...</div> : null}
        {c === null ? <div className="mono muted">Contest #{id} not found.</div> : null}

        {c ? (
          <>
            <div className="section-head" style={{ marginTop: 8 }}>
              <h1>
                Contest #{c.id} · {CONTEST_TYPE[c.contestType] ?? "?"}
              </h1>
              <span className={`pill ${statusClass(c.status)}`}>{CONTEST_STATUS[c.status] ?? "?"}</span>
            </div>

            <div className="big-num" style={{ fontSize: 40 }}>
              {formatUsdc(c.prizePool)}
            </div>
            <p className="mono muted">prize pool · {timeInfo(c)}</p>

            <section className="card" style={{ marginTop: 20 }}>
              <div className="kv">
                <span className="k">metric</span>
                <span className="v">{metricLabel(c.metric)}</span>
              </div>
              <div className="kv">
                <span className="k">entrants</span>
                <span className="v">{c.entrants}</span>
              </div>
              <div className="kv">
                <span className="k">headline winners (topN)</span>
                <span className="v">{c.topN}</span>
              </div>
              <div className="kv">
                <span className="k">winner cut</span>
                <span className="v">{(c.winnerCutBps / 100).toFixed(0)}%</span>
              </div>
              <div className="kv">
                <span className="k">platform fee</span>
                <span className="v">{(c.platformFeeBps / 100).toFixed(1)}%</span>
              </div>
              <div className="kv">
                <span className="k">sponsor</span>
                <span className="v">
                  <a href={`${EXPLORER}/address/${c.sponsor}`} target="_blank" rel="noreferrer">
                    {short(c.sponsor)}
                  </a>
                </span>
              </div>
              {c.protocolTarget !== "0x0000000000000000000000000000000000000000" ? (
                <div className="kv">
                  <span className="k">protocol target</span>
                  <span className="v">
                    <a href={`${EXPLORER}/address/${c.protocolTarget}`} target="_blank" rel="noreferrer">
                      {short(c.protocolTarget)}
                    </a>
                  </span>
                </div>
              ) : null}
            </section>

            <p className="mono muted" style={{ marginTop: 16 }}>
              <a href={`${EXPLORER}/address/${CONTRACTS.ContestEngine}`} target="_blank" rel="noreferrer">
                ContestEngine on Arcscan
              </a>
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
