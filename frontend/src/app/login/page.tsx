"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/pengu/AppHeader";
import { LoginModal } from "@/components/pengu/LoginModal";
import { AgonMark } from "@/components/redesign/AgonMark";
import { TagButton } from "@/components/redesign/TagButton";

/// Direct sign-in route. The same compact modal used by the product header is
/// the canonical Agon entry surface, so a deep link and an in-app sign-in
/// request never drift into two different authentication experiences.
export default function LoginPage() {
  const router = useRouter();
  const { me } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (me) router.replace("/app");
  }, [me, router]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1280px] items-center justify-center px-4 py-12 sm:px-6">
          <section className="relative w-full max-w-[560px] border border-[color:var(--hairline-strong)] bg-canvas-2 px-6 py-10 sm:px-12 sm:py-14">
            <span aria-hidden className="absolute -left-px -top-px h-4 w-4 border-l-2 border-t-2 border-ink" />
            <span aria-hidden className="absolute -right-px -top-px h-4 w-4 border-r-2 border-t-2 border-ink" />
            <span aria-hidden className="absolute -bottom-px -left-px h-4 w-4 border-b-2 border-l-2 border-ink" />
            <span aria-hidden className="absolute -bottom-px -right-px h-4 w-4 border-b-2 border-r-2 border-ink" />

            <AgonMark />
            <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.18em] text-accent">ACCESS CHECK</p>
            <h1 className="mt-3 font-stencil text-[clamp(2.5rem,7vw,4.5rem)] uppercase leading-[0.9] text-ink">ENTER AGON</h1>
            <p className="mt-5 max-w-[42ch] font-mono text-sm leading-relaxed text-ink-2">
              Sign in once to use the marketplace, publish a service, and open your provider workspace.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <TagButton onClick={() => setOpen(true)}>START SIGN IN</TagButton>
              <TagButton href="/" variant="ghost" size="sm">BACK</TagButton>
            </div>
            <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">WALLET OR EMAIL · ARC TESTNET</p>
          </section>
        </div>
      </main>
      <LoginModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
