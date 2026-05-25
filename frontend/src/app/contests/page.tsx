"use client";

import { useEffect, useState } from "react";
import { ConnectButton } from "@/components/ConnectButton";
import {
  CONTEST_STATUS,
  CONTEST_TYPE,
  fetchContests,
  formatUsdc,
  metricLabel,
  statusClass,
  type Contest,
} from "@/lib/contests";

export default function ContestsPage() {
  const [contests, setContests] = useState<Contest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchContests()
      .then(setContests)
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load contests"));
  }, []);

  return (
    <div className="wrap">
      <nav className="nav">
        <a className="wordmark" href="/">
          Arc<span>Run</span>
        </a>
        <div className="nav-links">
          <a href="/login">Sign in</a>
          <ConnectButton />
        </div>
      </nav>

      <div className="section-head">
        <h1>Contests</h1>
        <span className="mono muted">read live from ContestEngine on Arc</span>
      </div>

      {error ? <div className="mono err">{error}</div> : null}
      {contests === null && !error ? <div className="mono muted">loading from Arc...</div> : null}
      {contests && contests.length === 0 ? (
        <div className="mono muted">No contests yet. List one with the coordinator to see it here.</div>
      ) : null}

      {contests && contests.length > 0 ? (
        <div className="contest-grid">
          {contests.map((c) => (
            <a className="contest-card" key={c.id} href={`/contests/${c.id}`}>
              <div className="contest-top">
                <span className="mono muted">
                  #{c.id} · {CONTEST_TYPE[c.contestType] ?? "?"}
                </span>
                <span className={`pill ${statusClass(c.status)}`}>{CONTEST_STATUS[c.status] ?? "?"}</span>
              </div>
              <div className="big-num">{formatUsdc(c.prizePool)}</div>
              <div className="kv">
                <span className="k">metric</span>
                <span className="v">{metricLabel(c.metric)}</span>
              </div>
              <div className="kv">
                <span className="k">entrants</span>
                <span className="v">{c.entrants}</span>
              </div>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
