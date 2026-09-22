"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changeStaffPassword, staffLogin } from "@/lib/support";

export function SupportStaffLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mustChange, setMustChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");

  async function login(form: FormData) {
    setBusy(true); setError("");
    try {
      const password = String(form.get("password") ?? "");
      const result = await staffLogin(String(form.get("email") ?? ""), password);
      if (result.staff.mustChangePassword) { setCurrentPassword(password); setMustChange(true); }
      else router.replace("/support/admin");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign in failed"); }
    finally { setBusy(false); }
  }

  async function change(form: FormData) {
    const next = String(form.get("newPassword") ?? "");
    if (next !== String(form.get("confirmPassword") ?? "")) { setError("New passwords do not match"); return; }
    setBusy(true); setError("");
    try { await changeStaffPassword(currentPassword, next); router.replace("/support/admin"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Password could not be changed"); }
    finally { setBusy(false); }
  }

  return <form action={mustChange ? change : login} className="grid gap-5 border border-[color:var(--hairline-strong)] bg-canvas-2 p-7">
    {mustChange ? <><p className="font-sans text-sm leading-relaxed text-ink-2">Choose your own password before opening the team inbox.</p><label className="grid gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">New password<input required name="newPassword" type="password" minLength={12} maxLength={128} autoComplete="new-password" className="min-h-12 border border-[color:var(--hairline-strong)] bg-canvas px-4 font-sans text-sm normal-case tracking-normal text-ink outline-none focus:border-accent" /></label><label className="grid gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">Confirm password<input required name="confirmPassword" type="password" minLength={12} maxLength={128} autoComplete="new-password" className="min-h-12 border border-[color:var(--hairline-strong)] bg-canvas px-4 font-sans text-sm normal-case tracking-normal text-ink outline-none focus:border-accent" /></label></> : <><label className="grid gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">Work email<input required name="email" type="email" autoComplete="username" className="min-h-12 border border-[color:var(--hairline-strong)] bg-canvas px-4 font-sans text-sm normal-case tracking-normal text-ink outline-none focus:border-accent" /></label><label className="grid gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">Password<input required name="password" type="password" autoComplete="current-password" className="min-h-12 border border-[color:var(--hairline-strong)] bg-canvas px-4 font-sans text-sm normal-case tracking-normal text-ink outline-none focus:border-accent" /></label></>}
    {error ? <p role="alert" className="font-mono text-xs text-danger">{error}</p> : null}
    <button disabled={busy} className="min-h-12 bg-accent px-6 font-mono text-xs uppercase tracking-[0.14em] text-canvas disabled:opacity-50">{busy ? "Checking..." : mustChange ? "Set password" : "Open team inbox"}</button>
  </form>;
}
