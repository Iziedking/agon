"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, useSignMessage, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { arcTestnet } from "@/lib/arc";
import { loginWithSigner, signInWithEmail } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import {
  BracketedCell,
  CornerMarkers,
  SectionHeader,
  StatusChip,
  TagButton,
} from "@/components/redesign";

/// /login. The standalone sign-in surface, on the flat ink-on-canvas system.
/// The primary entry is the TopNav modal; this page is the direct-URL fallback
/// (bookmarks, deep links). Same two-ways-in logic as the modal — only the
/// presentation is the redesign.

export default function LoginPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { openConnectModal } = useConnectModal();
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { me, loading, refresh, signOut } = useAuth();

  useEffect(() => {
    if (me) router.replace("/market");
  }, [me, router]);

  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [circleBusy, setCircleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWeb3() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      await loginWithSigner(address, (m) => signMessageAsync({ message: m }));
      await refresh();
    } catch (e) {
      setError(friendlyError(e, "sign in failed. try again."));
    } finally {
      setBusy(false);
    }
  }

  async function signInEmail() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("enter an email first");
      return;
    }
    setCircleBusy(true);
    setError(null);
    try {
      await signInWithEmail(trimmed);
      await refresh();
    } catch (e) {
      setError(friendlyError(e, "email sign-in failed. try again."));
    } finally {
      setCircleBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1600px] px-4 sm:px-6 pt-16">
        <CornerMarkers />
        <SectionHeader
          heading="SIGN IN"
          subDeck={<>two ways in. bring a wallet, or start with an email and we make one for you.</>}
        />
      </section>

      <section className="mx-auto max-w-[1600px] px-4 sm:px-6 py-10">
        {me ? (
          <div className="max-w-[560px]">
            <BracketedCell pad="lg">
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                <span aria-hidden className="text-accent">■</span> SESSION
              </div>
              <div className="mt-4 flex items-center gap-2">
                <StatusChip tone="ok">SIGNED IN</StatusChip>
                <span className="font-mono text-sm text-ink">
                  {me.address.slice(0, 6)}…{me.address.slice(-4)}
                </span>
              </div>
              <p className="mt-2 font-mono text-sm text-ink-2">
                {me.canEnterContests ? "ready to compete." : "not yet qualified — run a few cycles to enter contests."}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <TagButton href="/dashboard">GO TO DASHBOARD</TagButton>
                <TagButton variant="ghost" arrow={false} onClick={signOut}>SIGN OUT</TagButton>
              </div>
            </BracketedCell>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Web3 wallet */}
            <BracketedCell pad="lg" className="flex flex-col">
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                <span aria-hidden className="text-accent">■</span> WEB3 WALLET
              </div>
              <h2 className="mt-3 font-stencil uppercase text-ink" style={{ fontSize: "26px", lineHeight: 1.05 }}>
                CONNECT A WALLET
              </h2>
              <p className="mt-3 font-mono text-sm leading-[1.55] text-ink-2">
                sign a free message to prove it&apos;s yours. no gas, no approval.
              </p>
              <div className="mt-6">
                {!mounted ? (
                  <TagButton disabled arrow={false}>CONNECT WALLET</TagButton>
                ) : !isConnected ? (
                  <TagButton disabled={!openConnectModal} onClick={openConnectModal} arrow={false}>
                    CONNECT WALLET
                  </TagButton>
                ) : chainId !== arcTestnet.id ? (
                  <TagButton onClick={() => switchChain({ chainId: arcTestnet.id })} arrow={false}>
                    SWITCH TO ARC TESTNET
                  </TagButton>
                ) : (
                  <TagButton disabled={busy} onClick={signInWeb3}>
                    {busy ? "SIGNING…" : "SIGN IN WITH WALLET"}
                  </TagButton>
                )}
              </div>
            </BracketedCell>

            {/* Email */}
            <BracketedCell pad="lg" className="flex flex-col">
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                <span aria-hidden className="text-accent">■</span> EMAIL
              </div>
              <h2 className="mt-3 font-stencil uppercase text-ink" style={{ fontSize: "26px", lineHeight: 1.05 }}>
                NO WALLET NEEDED
              </h2>
              <p className="mt-3 font-mono text-sm leading-[1.55] text-ink-2">
                we create a wallet and seed it with testnet USDC. no password, no seed phrase.
              </p>
              <div className="mt-6 flex flex-col gap-3">
                <input
                  className="w-full border border-[color:var(--hairline)] bg-canvas px-3 py-2.5 font-mono text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none"
                  type="email"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={circleBusy}
                  onKeyDown={(e) => { if (e.key === "Enter") signInEmail(); }}
                />
                <div>
                  <TagButton disabled={circleBusy} onClick={signInEmail}>
                    {circleBusy ? "SETTING UP…" : "CONTINUE"}
                  </TagButton>
                </div>
              </div>
            </BracketedCell>
          </div>
        )}

        {error ? (
          <p className="mt-6 font-mono text-sm" style={{ color: "var(--err)" }}>{error}</p>
        ) : null}
        {loading ? <p className="mt-6 font-mono text-sm text-ink-3">checking session…</p> : null}
      </section>

      <Footer />
    </div>
  );
}
