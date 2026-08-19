"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/pengu/AppHeader";
import { LoginModal } from "@/components/pengu/LoginModal";

/// Direct sign-in route. The same compact modal used by the product header is
/// the canonical Agon entry surface, so a deep link and an in-app sign-in
/// request never drift into two different authentication experiences.
export default function LoginPage() {
  const router = useRouter();
  const { me } = useAuth();

  useEffect(() => {
    if (me) router.replace("/market");
  }, [me, router]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1280px] items-center justify-center px-4 py-12 sm:px-6">
          <div className="w-full max-w-[440px] border border-[color:var(--hairline)] bg-canvas p-6 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3 sm:p-8">
            PRIVATE ACCESS · ARC TESTNET
          </div>
        </div>
      </main>
      <LoginModal open={!me} onClose={() => router.push("/")} />
    </div>
  );
}
