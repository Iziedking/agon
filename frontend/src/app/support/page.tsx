import type { Metadata } from "next";
import { SupportChat } from "@/components/support/SupportChat";
import { AgonMark } from "@/components/redesign/AgonMark";

export const metadata: Metadata = { title: "Support", description: "Get help from the AGON guide or support team." };

export default function SupportPage() {
  return <main className="min-h-screen bg-canvas px-5 py-10 text-ink md:px-10 md:py-16"><div className="mx-auto max-w-[980px]"><div className="flex flex-wrap items-center justify-between gap-4"><AgonMark /><a href="/" className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-accent">Back to AGON →</a></div><p className="mt-12 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">HELP CENTER</p><h1 className="mt-3 max-w-[16ch] font-stencil text-[clamp(42px,7vw,82px)] uppercase leading-[0.92]">TELL US WHAT YOU NEED</h1><p className="mt-6 max-w-[65ch] font-sans text-base leading-relaxed text-ink-2">The AGON guide answers common questions first. If your issue needs account or service review, the same conversation moves to a team member.</p><div className="mt-10"><SupportChat /></div></div></main>;
}
