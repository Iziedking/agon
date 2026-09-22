import type { Metadata } from "next";
import { AgonMark } from "@/components/redesign/AgonMark";
import { SupportStaffSetup } from "@/components/support/SupportStaffSetup";
export const metadata: Metadata = { title: "Support team setup" };
export default function SupportSetupPage() { return <main className="min-h-screen bg-canvas px-5 py-10 text-ink md:px-10 md:py-16"><div className="mx-auto max-w-[900px]"><AgonMark /><p className="mt-10 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">OWNER CONTROL</p><h1 className="mt-3 font-stencil text-[clamp(42px,6vw,72px)] uppercase leading-none">SUPPORT TEAM SETUP</h1><p className="mt-5 max-w-[65ch] font-sans text-sm leading-relaxed text-ink-2">Create or disable named support accounts. The owner admin token stays in memory for this page and is not stored in the browser.</p><div className="mt-9"><SupportStaffSetup /></div></div></main>; }
