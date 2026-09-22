"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupportTicket, readSupportTicket, sendSupportMessage, type SupportMessage, type SupportTicket } from "@/lib/support";

const STORAGE_KEY = "agon-support-ticket-v1";

type Access = { ticketId: string; reference: string; accessToken: string };

export function SupportChat() {
  const [access, setAccess] = useState<Access | null>(null);
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");

  const load = useCallback(async (current: Access) => {
    try {
      const result = await readSupportTicket(current.ticketId, current.accessToken);
      setTicket(result.ticket); setMessages(result.messages); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load this conversation"); }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try { const parsed = JSON.parse(saved) as Access; setAccess(parsed); void load(parsed); } catch { sessionStorage.removeItem(STORAGE_KEY); }
  }, [load]);

  useEffect(() => {
    if (!access) return;
    const timer = window.setInterval(() => void load(access), 15_000);
    return () => window.clearInterval(timer);
  }, [access, load]);

  async function start(form: FormData) {
    setBusy(true); setError("");
    try {
      const created = await createSupportTicket({
        requesterName: String(form.get("name") ?? ""), requesterEmail: String(form.get("email") ?? ""),
        subject: String(form.get("subject") ?? ""), message: String(form.get("message") ?? ""),
      });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(created)); setAccess(created); await load(created);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start support"); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!access || !draft.trim()) return;
    setBusy(true); setError("");
    try { await sendSupportMessage(access.ticketId, access.accessToken, draft.trim()); setDraft(""); await load(access); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Message could not be sent"); }
    finally { setBusy(false); }
  }

  if (!access) return (
    <form action={start} className="grid gap-5 border border-[color:var(--hairline-strong)] bg-canvas-2 p-6 md:p-8">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="grid gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">Your name<input required name="name" minLength={2} maxLength={80} className="min-h-12 border border-[color:var(--hairline-strong)] bg-canvas px-4 font-sans text-sm normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
        <label className="grid gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">Email<input required name="email" type="email" maxLength={254} className="min-h-12 border border-[color:var(--hairline-strong)] bg-canvas px-4 font-sans text-sm normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
      </div>
      <label className="grid gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">What do you need help with?<input required name="subject" minLength={4} maxLength={140} className="min-h-12 border border-[color:var(--hairline-strong)] bg-canvas px-4 font-sans text-sm normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
      <label className="grid gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">Tell us what happened<textarea required name="message" minLength={2} maxLength={4000} rows={6} className="border border-[color:var(--hairline-strong)] bg-canvas p-4 font-sans text-sm normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
      <p className="font-mono text-[11px] leading-relaxed text-ink-3">Never send a password, private key, seed phrase, admin token, or wallet signature.</p>
      {error ? <p role="alert" className="font-mono text-xs text-danger">{error}</p> : null}
      <button disabled={busy} className="min-h-12 bg-accent px-6 font-mono text-xs uppercase tracking-[0.14em] text-canvas disabled:opacity-50">{busy ? "Opening support..." : "Start conversation"}</button>
    </form>
  );

  return (
    <section className="border border-[color:var(--hairline-strong)] bg-canvas-2">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--hairline)] p-5">
        <div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{access.reference}</p><h2 className="mt-1 font-sans text-xl font-semibold text-ink">{ticket?.subject ?? "Loading conversation"}</h2></div>
        <span className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">{ticket?.status?.replaceAll("_", " ") ?? "loading"}</span>
      </header>
      <div aria-live="polite" className="max-h-[52vh] space-y-4 overflow-y-auto p-5 md:p-7">
        {messages.map((message) => <article key={message.messageId} className={`max-w-[78ch] border p-4 ${message.authorType === "user" ? "ml-auto border-accent bg-canvas" : "border-[color:var(--hairline)] bg-canvas-3"}`}><div className="mb-2 flex justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3"><span>{message.authorName}</span><time>{new Date(message.createdAt).toLocaleString()}</time></div><p className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{message.body}</p></article>)}
      </div>
      <div className="border-t border-[color:var(--hairline)] p-5">
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} rows={3} aria-label="Reply" placeholder="Add a message" className="w-full border border-[color:var(--hairline-strong)] bg-canvas p-4 font-sans text-sm text-ink outline-none focus:border-accent" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">{error ? <p role="alert" className="font-mono text-xs text-danger">{error}</p> : <p className="font-mono text-[10px] text-ink-3">The team sees this entire conversation if it is escalated.</p>}<button onClick={() => void send()} disabled={busy || !draft.trim()} className="min-h-11 bg-accent px-6 font-mono text-xs uppercase tracking-[0.12em] text-canvas disabled:opacity-50">Send</button></div>
      </div>
    </section>
  );
}
