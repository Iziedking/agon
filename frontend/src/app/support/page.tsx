import type { Metadata } from "next";
import { SupportChat } from "@/components/support/SupportChat";
import { AgonMark } from "@/components/redesign/AgonMark";

export const metadata: Metadata = { title: "Support", description: "Get help from the AGON guide or support team." };

export default function SupportPage() {
  return <main className="min-h-screen bg-canvas px-5 py-10 text-ink md:px-10 md:py-16"><div className="mx-auto max-w-[980px]"><AgonMark /><p className="mt-12 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">AGON SUPPORT</p><h1 className="mt-3 max-w-[16ch] font-stencil text-[clamp(42px,7vw,82px)] uppercase leading-[0.92]">GET HELP WITHOUT LOSING CONTEXT</h1><p className="mt-6 max-w-[65ch] font-sans text-base leading-relaxed text-ink-2">Start with the AGON guide. If the issue needs account or service review, the same conversation moves to the team inbox.</p><div className="mt-10"><SupportChat /></div><p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Team member? <a className="text-accent underline" href="/support/admin/login">Open the support workspace</a></p></div></main>;
}
