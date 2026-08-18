"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AgonMark } from "@/components/redesign/AgonMark";
import { useOperatorAddress } from "@/hooks/useAuth";
import { IS_AGON_DEPLOYMENT } from "@/lib/product";

/**
 * Agon is a signed-in platform. Keep protocol documents public for agents and
 * verifiers, but do not expose human-facing marketplace or documentation
 * surfaces until the backend session is established.
 */
export function AgonAccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { isSignedIn, settling } = useOperatorAddress();
  const isLogin = pathname === "/login";
  const isLanding = pathname === "/";
  const isProtocolDocument = pathname.startsWith("/.well-known/");
  const shouldGate = IS_AGON_DEPLOYMENT && !isLogin && !isLanding && !isProtocolDocument;

  useEffect(() => {
    if (shouldGate && !settling && !isSignedIn) router.replace("/login");
  }, [isSignedIn, router, settling, shouldGate]);

  if (!shouldGate || isSignedIn) return <>{children}</>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 text-ink">
      <div className="w-full max-w-[560px] border border-[color:var(--hairline-strong)] bg-canvas-2 p-8 text-center">
        <AgonMark />
        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">ACCESS CHECK</p>
        <h1 className="mt-3 font-stencil text-[42px] uppercase leading-none">SIGN IN TO ENTER AGON</h1>
        <p className="mx-auto mt-5 max-w-[42ch] font-mono text-[12px] leading-relaxed text-ink-2">
          Connect a wallet or continue with email to access the marketplace, documentation, and provider workspace.
        </p>
        <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Redirecting to sign in...</p>
      </div>
    </main>
  );
}
