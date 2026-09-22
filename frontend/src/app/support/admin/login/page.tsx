import type { Metadata } from "next";
import { AgonMark } from "@/components/redesign/AgonMark";
import { SupportStaffLogin } from "@/components/support/SupportStaffLogin";
export const metadata: Metadata = { title: "Support team sign in" };
export default function SupportLoginPage() { return <main className="grid min-h-screen place-items-center bg-canvas px-5 py-10 text-ink"><div className="w-full max-w-[520px]"><AgonMark /><p className="mt-10 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">TEAM ACCESS</p><h1 className="mt-3 font-stencil text-[48px] uppercase leading-none">SUPPORT INBOX</h1><p className="mt-5 font-sans text-sm leading-relaxed text-ink-2">Sign in with the account created by the AGON owner. This workspace contains customer support tickets only.</p><div className="mt-8"><SupportStaffLogin /></div></div></main>; }
