"use client";

import { useCallback, useEffect, useState } from "react";
import { BracketedCell, CornerMarkers } from "@/components/redesign";
import { EXPLORER } from "@/lib/arc";

/// Internal admin console. Not linked from the nav. Gated entirely by the
/// ADMIN_TOKEN, sent as the x-admin-token header on every call (the same token
/// that guards /admin/events on the backend). Shows every contract's live USDC
/// balance, the treasury and coordinator wallets, and lets an admin withdraw
/// treasury USDC or cancel a wrongly-opened contest / challenge. The token is
/// kept in localStorage so a refresh during the demo doesn't lock you out.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";
const TOKEN_KEY = "arcrun_admin_token";

interface Overview {
  chainId: number;
  usdc: string;
  coordinator: { address: string; usdc: string; gas: string } | null;
  treasury: { address: string; usdc: string } | null;
  contracts: Array<{ key: string; address: string; usdc: string }>;
  counts: {
    contests: number; challenges: number; operators: number; agents: number;
    openContests: number; liveChallenges: number;
  };
}

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [draftToken, setDraftToken] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (saved) setToken(saved);
  }, []);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${AUTH_URL}/admin/overview`, { headers: { "x-admin-token": tok } });
      if (res.status === 401) throw new Error("wrong token");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `http ${res.status}`);
      setData((await res.json()) as Overview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load");
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  function unlock() {
    const t = draftToken.trim();
    if (!t) return;
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  }
  function lock() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setData(null);
    setDraftToken("");
  }

  if (!token) {
    return (
      <Shell>
        <BracketedCell pad="md">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">ADMIN TOKEN</div>
          <input
            type="password"
            value={draftToken}
            onChange={(e) => setDraftToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
            placeholder="paste ADMIN_TOKEN"
            className="mt-3 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink"
          />
          <button
            onClick={unlock}
            className="mt-3 bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
          >
            UNLOCK →
          </button>
        </BracketedCell>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
          {data ? `CHAIN ${data.chainId}` : ""}
        </span>
        <div className="flex items-center gap-4">
          <button onClick={() => token && void load(token)} className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
            {loading ? "REFRESHING…" : "REFRESH"}
          </button>
          <button onClick={lock} className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
            LOCK
          </button>
        </div>
      </div>

      {error ? <p className="mb-4 font-mono text-[12px] text-[color:var(--err)]">{error}</p> : null}

      {data ? (
        <div className="flex flex-col gap-6">
          <CountsRow counts={data.counts} />
          <WalletsRow data={data} />
          <ContractsTable contracts={data.contracts} />
          <div className="grid gap-6 lg:grid-cols-2">
            <WithdrawCard token={token} treasuryUsdc={data.treasury?.usdc ?? data.coordinator?.usdc ?? "0.00"} onDone={() => void load(token)} />
            <CancelCard token={token} onDone={() => void load(token)} />
          </div>
        </div>
      ) : !error ? (
        <p className="font-mono text-sm text-ink-2">loading…</p>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <section className="relative mx-auto max-w-[1100px] px-6 py-16">
        <CornerMarkers />
        <h1 className="font-stencil uppercase text-ink" style={{ fontSize: "clamp(32px,5vw,56px)", lineHeight: 0.95, letterSpacing: "-0.02em" }}>
          ADMIN CONSOLE
        </h1>
        <p className="mt-2 mb-8 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          <span aria-hidden className="text-accent">■</span> CONTRACTS · TREASURY · LIVE BALANCES
        </p>
        {children}
      </section>
    </div>
  );
}

function CountsRow({ counts }: { counts: Overview["counts"] }) {
  const cells = [
    { label: "CONTESTS", value: counts.contests, sub: `${counts.openContests} open` },
    { label: "CHALLENGES", value: counts.challenges, sub: `${counts.liveChallenges} live` },
    { label: "OPERATORS", value: counts.operators },
    { label: "AGENTS", value: counts.agents },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {cells.map((c) => (
        <BracketedCell key={c.label} pad="sm">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{c.label}</div>
          <div className="mt-1 font-stencil text-[28px] leading-none text-ink">{c.value}</div>
          {c.sub ? <div className="mt-1 font-mono text-[10px] text-ink-3">{c.sub}</div> : null}
        </BracketedCell>
      ))}
    </div>
  );
}

function WalletsRow({ data }: { data: Overview }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <BracketedCell pad="sm">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">TREASURY (FEES)</div>
        {data.treasury ? (
          <>
            <AddrLine address={data.treasury.address} />
            <div className="mt-1 font-stencil text-[22px] text-ink">{data.treasury.usdc} <span className="font-mono text-[11px] text-ink-3">USDC</span></div>
          </>
        ) : (
          <div className="mt-2 font-mono text-[11px] text-ink-3">treasury read failed</div>
        )}
      </BracketedCell>
      <BracketedCell pad="sm">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">COORDINATOR (SIGNER)</div>
        {data.coordinator ? (
          <>
            <AddrLine address={data.coordinator.address} />
            <div className="mt-1 font-stencil text-[22px] text-ink">{data.coordinator.usdc} <span className="font-mono text-[11px] text-ink-3">USDC</span></div>
            <div className="font-mono text-[10px] text-ink-3">gas: {data.coordinator.gas} USDC</div>
          </>
        ) : (
          <div className="mt-2 font-mono text-[11px] text-ink-3">no signer configured</div>
        )}
      </BracketedCell>
    </div>
  );
}

function ContractsTable({ contracts }: { contracts: Overview["contracts"] }) {
  return (
    <BracketedCell pad="sm">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">CONTRACTS · USDC HELD</div>
      <div className="flex flex-col">
        {contracts.map((ct) => (
          <div key={ct.key} className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-2.5 last:border-0">
            <div className="min-w-0">
              <div className="font-mono text-[12px] uppercase tracking-[0.08em] text-ink">{ct.key}</div>
              <AddrLine address={ct.address} />
            </div>
            <div className="font-stencil text-[18px] text-ink">{ct.usdc} <span className="font-mono text-[10px] text-ink-3">USDC</span></div>
          </div>
        ))}
      </div>
    </BracketedCell>
  );
}

function AddrLine({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked; the explorer link still works */
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <a
        href={`${EXPLORER}/address/${address}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-[11px] text-ink-3 hover:text-ink"
        title={address}
      >
        {short(address)} ↗
      </a>
      <button
        onClick={copy}
        title="copy full address"
        className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 hover:text-accent"
      >
        {copied ? "COPIED" : "COPY"}
      </button>
    </span>
  );
}

function WithdrawCard({ token, treasuryUsdc, onDone }: { token: string; treasuryUsdc: string; onDone: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${AUTH_URL}/admin/treasury/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ to: to.trim(), amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `http ${res.status}`);
      setResult({ ok: true, text: (data as { hash: string }).hash });
      setTo(""); setAmount("");
      onDone();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "failed" });
    }
    setBusy(false);
  }

  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">WITHDRAW TREASURY USDC</div>
      <div className="mt-1 font-mono text-[10px] text-ink-3">available: {treasuryUsdc} USDC</div>
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="destination 0x…"
        className="mt-3 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink" />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="amount in USDC, e.g. 10.50"
        className="mt-2 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink" />
      <button onClick={submit} disabled={busy || !to || !amount}
        className="mt-3 bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50">
        {busy ? "SENDING…" : "WITHDRAW →"}
      </button>
      {result ? (
        result.ok ? (
          <a href={`${EXPLORER}/tx/${result.text}`} target="_blank" rel="noreferrer" className="mt-2 block font-mono text-[10px] text-[color:var(--ok)] hover:underline">
            sent · {short(result.text)} ↗
          </a>
        ) : (
          <p className="mt-2 font-mono text-[10px] text-[color:var(--err)]">{result.text}</p>
        )
      ) : null}
    </BracketedCell>
  );
}

function CancelCard({ token, onDone }: { token: string; onDone: () => void }) {
  const [source, setSource] = useState<"contest" | "challenge">("contest");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${AUTH_URL}/admin/${source}/${Number(id)}/cancel`, {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `http ${res.status}`);
      setResult({ ok: true, text: (data as { hash: string }).hash });
      setId("");
      onDone();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "failed" });
    }
    setBusy(false);
  }

  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">CANCEL A WRONG EVENT</div>
      <div className="mt-1 font-mono text-[10px] text-ink-3">contest refunds the sponsor · challenge frees entrant stakes</div>
      <div className="mt-3 flex gap-2">
        <select value={source} onChange={(e) => setSource(e.target.value as "contest" | "challenge")}
          className="border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink">
          <option value="contest">CONTEST</option>
          <option value="challenge">CHALLENGE</option>
        </select>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id" inputMode="numeric"
          className="w-24 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink" />
        <button onClick={submit} disabled={busy || !id}
          className="border border-[color:var(--err)] px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-[color:var(--err)] hover:bg-canvas-3 disabled:opacity-50">
          {busy ? "CANCELLING…" : "CANCEL"}
        </button>
      </div>
      {result ? (
        result.ok ? (
          <a href={`${EXPLORER}/tx/${result.text}`} target="_blank" rel="noreferrer" className="mt-2 block font-mono text-[10px] text-[color:var(--ok)] hover:underline">
            cancelled · {short(result.text)} ↗
          </a>
        ) : (
          <p className="mt-2 font-mono text-[10px] text-[color:var(--err)]">{result.text}</p>
        )
      ) : null}
    </BracketedCell>
  );
}
