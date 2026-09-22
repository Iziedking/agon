"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { assignStaffTicket, listStaffTickets, readStaffTicket, replyToStaffTicket, staffLogout, staffSession, updateStaffTicket, type SupportMessage, type SupportStaff, type SupportTicket } from "@/lib/support";

const FILTERS = ["all", "open", "in_progress", "waiting_user", "resolved"] as const;

export function SupportAdminWorkspace() {
  const router = useRouter();
  const [staff, setStaff] = useState<SupportStaff | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    try { const result = await listStaffTickets(filter); setTickets(result.tickets); if (!selectedId && result.tickets[0]) setSelectedId(String(result.tickets[0].ticket_id ?? result.tickets[0].ticketId)); }
    catch (cause) { if (cause instanceof Error && /sign-in/.test(cause.message)) router.replace("/support/admin/login"); else setError(cause instanceof Error ? cause.message : "Could not load tickets"); }
  }, [filter, router, selectedId]);
  const loadSelected = useCallback(async () => {
    if (!selectedId) return;
    try { const result = await readStaffTicket(selectedId); setSelected(result.ticket); setMessages(result.messages); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load the ticket"); }
  }, [selectedId]);

  useEffect(() => { staffSession().then((result) => { if (result.staff.mustChangePassword) router.replace("/support/admin/login"); else setStaff(result.staff); }).catch(() => router.replace("/support/admin/login")); }, [router]);
  useEffect(() => { if (staff) void loadList(); }, [staff, filter, loadList]);
  useEffect(() => { void loadSelected(); }, [loadSelected]);
  useEffect(() => { if (!staff) return; const timer = window.setInterval(() => { void loadList(); void loadSelected(); }, 15_000); return () => window.clearInterval(timer); }, [staff, loadList, loadSelected]);

  const openCount = useMemo(() => tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length, [tickets]);

  async function run(action: () => Promise<unknown>) { setBusy(true); setError(""); try { await action(); await Promise.all([loadList(), loadSelected()]); } catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed"); } finally { setBusy(false); } }
  async function sendReply() { if (!selectedId || !reply.trim()) return; const text = reply.trim(); setReply(""); await run(() => replyToStaffTicket(selectedId, text, internal)); }

  return <main className="min-h-screen bg-canvas text-ink">
    <header className="flex min-h-20 flex-wrap items-center justify-between gap-4 border-b border-[color:var(--hairline)] px-5 py-4 md:px-8"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">AGON SUPPORT TEAM</p><h1 className="mt-1 font-sans text-2xl font-semibold">Shared inbox</h1></div><div className="flex items-center gap-4"><div className="text-right"><p className="font-sans text-sm font-medium">{staff?.displayName ?? "Loading"}</p><p className="font-mono text-[10px] uppercase text-ink-3">{staff?.role}</p></div><button onClick={() => void staffLogout().finally(() => router.replace("/support/admin/login"))} className="min-h-11 border border-[color:var(--hairline-strong)] px-4 font-mono text-[10px] uppercase tracking-[0.12em]">Sign out</button></div></header>
    <div className="grid min-h-[calc(100vh-80px)] lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="border-b border-[color:var(--hairline)] lg:border-b-0 lg:border-r"><div className="border-b border-[color:var(--hairline)] p-5"><div className="flex items-baseline justify-between"><p className="font-sans text-sm font-semibold">Team queue</p><span className="font-mono text-xs text-accent">{openCount} active</span></div><div className="mt-4 flex flex-wrap gap-2">{FILTERS.map((item) => <button key={item} onClick={() => setFilter(item)} className={`min-h-10 border px-3 font-mono text-[9px] uppercase tracking-[0.1em] ${filter === item ? "border-accent bg-accent text-canvas" : "border-[color:var(--hairline)] text-ink-2"}`}>{item.replaceAll("_", " ")}</button>)}</div></div><div className="max-h-[42vh] overflow-y-auto lg:max-h-[calc(100vh-210px)]">{tickets.length === 0 ? <p className="p-6 font-sans text-sm text-ink-3">No tickets in this view.</p> : tickets.map((ticket) => { const id = String(ticket.ticket_id ?? ticket.ticketId); return <button key={id} onClick={() => setSelectedId(id)} className={`block w-full border-b border-[color:var(--hairline)] p-5 text-left ${selectedId === id ? "bg-canvas-3" : "bg-canvas hover:bg-canvas-2"}`}><div className="flex justify-between gap-3"><span className="font-mono text-[9px] uppercase text-ink-3">{ticket.reference}</span><span className="font-mono text-[9px] uppercase text-accent">{ticket.status.replaceAll("_", " ")}</span></div><p className="mt-2 line-clamp-2 font-sans text-sm font-semibold">{ticket.subject}</p><p className="mt-2 font-mono text-[9px] uppercase text-ink-3">{ticket.assigned_name ? `with ${ticket.assigned_name}` : "unassigned"}</p></button>; })}</div></aside>
      <section className="min-w-0">{!selected ? <div className="grid min-h-[60vh] place-items-center p-8 text-center"><div><p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-3">Select a ticket</p><p className="mt-3 font-sans text-sm text-ink-2">The full conversation will appear here.</p></div></div> : <><header className="border-b border-[color:var(--hairline)] p-5 md:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{selected.reference}</p><h2 className="mt-2 font-sans text-2xl font-semibold">{selected.subject}</h2><p className="mt-2 font-sans text-sm text-ink-2">{selected.requester_name} · {selected.requester_email}</p></div><div className="flex flex-wrap gap-2">{!selected.assigned_staff_id ? <button disabled={busy} onClick={() => void run(() => assignStaffTicket(selectedId))} className="min-h-11 bg-accent px-4 font-mono text-[10px] uppercase tracking-[0.12em] text-canvas">Take ticket</button> : null}<select aria-label="Ticket priority" value={selected.priority} onChange={(event) => void run(() => updateStaffTicket(selectedId, selected.status, event.target.value))} className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-[10px] uppercase text-ink"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select><select aria-label="Ticket status" value={selected.status} onChange={(event) => void run(() => updateStaffTicket(selectedId, event.target.value))} className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-[10px] uppercase text-ink"><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting_user">Waiting for user</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></div></div></header><div className="max-h-[48vh] space-y-4 overflow-y-auto p-5 md:p-7">{messages.map((message) => <article key={message.messageId} className={`max-w-[78ch] border p-4 ${message.visibility === "internal" ? "border-warning bg-canvas-3" : message.authorType === "user" ? "border-[color:var(--hairline)] bg-canvas" : "ml-auto border-accent bg-canvas-2"}`}><div className="mb-2 flex flex-wrap justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3"><span>{message.authorName}{message.visibility === "internal" ? " · internal note" : ""}</span><time>{new Date(message.createdAt).toLocaleString()}</time></div><p className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{message.body}</p></article>)}</div><div className="border-t border-[color:var(--hairline)] p-5 md:p-7"><textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={4} maxLength={4000} aria-label="Team reply" placeholder={internal ? "Add an internal note for teammates" : "Reply to the user"} className="w-full border border-[color:var(--hairline-strong)] bg-canvas p-4 font-sans text-sm text-ink outline-none focus:border-accent" /><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><label className="flex min-h-11 cursor-pointer items-center gap-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-2"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /> Internal note</label><button disabled={busy || !reply.trim()} onClick={() => void sendReply()} className="min-h-11 bg-accent px-6 font-mono text-[10px] uppercase tracking-[0.12em] text-canvas disabled:opacity-50">{internal ? "Save note" : "Send reply"}</button></div>{error ? <p role="alert" className="mt-3 font-mono text-xs text-danger">{error}</p> : null}</div></>}</section>
    </div>
  </main>;
}
