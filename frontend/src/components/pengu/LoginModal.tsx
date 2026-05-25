"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAccount, useChainId, useConnect, useSignMessage, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet } from "@/lib/arc";
import { loginWithSigner } from "@/lib/auth";
import { circleConfigured, createCircleAccount } from "@/lib/circle";
import { useAuth } from "@/hooks/useAuth";

const pillSolid =
  "group flex w-full items-center justify-between rounded-pill bg-pengu-blue px-6 py-3.5 font-display text-sm uppercase tracking-wide text-white transition-transform duration-150 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60";
const pillGhost =
  "group flex w-full items-center justify-between rounded-pill border border-pengu-blue/50 px-6 py-3.5 font-display text-sm uppercase tracking-wide text-pengu-blue transition-colors hover:bg-pengu-blue/10 disabled:opacity-60";

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Arrow() {
  return <span className="transition-transform duration-150 group-hover:translate-x-1">→</span>;
}

/// The login popout: a swift, animated modal that picks a path (email passkey or
/// wallet), in the arena design. Reuses the SIWE plus Circle auth logic.
export function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, isPending: connecting } = useConnect();
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { me, refresh, signOut } = useAuth();

  const [view, setView] = useState<"choose" | "email">("choose");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [circleBusy, setCircleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setView("choose");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function signInWeb3() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      await loginWithSigner(address, (m) => signMessageAsync({ message: m }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function signInCircle(mode: "Register" | "Login") {
    if (!email) {
      setError("enter an email first");
      return;
    }
    setCircleBusy(true);
    setError(null);
    try {
      const account = await createCircleAccount(email, mode);
      await loginWithSigner(account.address, (m) => account.signMessage({ message: m }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "passkey login failed");
    } finally {
      setCircleBusy(false);
    }
  }

  const wallet: { label: string; onClick?: () => void; disabled: boolean } = !mounted
    ? { label: "connect a wallet", disabled: true }
    : !isConnected
      ? { label: connecting ? "check your wallet" : "connect a wallet", onClick: () => connect({ connector: injected() }), disabled: connecting }
      : chainId !== arcTestnet.id
        ? { label: "switch to arc", onClick: () => switchChain({ chainId: arcTestnet.id }), disabled: false }
        : { label: busy ? "signing" : "sign in with wallet", onClick: signInWeb3, disabled: busy };

  const short = me ? `${me.address.slice(0, 6)}…${me.address.slice(-4)}` : "";
  const contentKey = me ? "account" : view;
  const dur = reduce ? 0 : 0.28;
  const stepDur = reduce ? 0 : 0.18;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-modal flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(27,17,64,0.55)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-[420px] rounded-card bg-white p-8 shadow-[0_30px_80px_rgba(27,17,64,0.35)]"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: dur, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <span className="font-display text-xs uppercase tracking-wide text-pengu-blue">welcome</span>
              <button onClick={onClose} aria-label="close" className="text-lg leading-none text-pengu-dark/40 transition-colors hover:text-pengu-dark">
                ✕
              </button>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={contentKey}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: stepDur, ease: [0.16, 1, 0.3, 1] }}
              >
                {me ? (
                  <div className="mt-4">
                    <h2 className="font-bubble text-2xl uppercase text-pengu-dark">you are in</h2>
                    <p className="mt-2 font-mono text-sm text-pengu-dark/70">signed in as {short}</p>
                    <div className="mt-6 flex flex-col gap-3">
                      <a href="/contests" className={pillSolid}>
                        <span>enter the arena</span>
                        <Arrow />
                      </a>
                      <button className={pillGhost} onClick={signOut}>
                        <span>sign out</span>
                        <span />
                      </button>
                    </div>
                  </div>
                ) : view === "choose" ? (
                  <div className="mt-4">
                    <h2 className="font-bubble text-2xl uppercase text-pengu-dark">sign in to arcrun</h2>
                    <p className="mt-2 text-sm text-pengu-dark/65">
                      two ways in. both give you an onchain identity to run agents and enter contests.
                    </p>
                    <div className="mt-6 flex flex-col gap-3">
                      <button className={pillSolid} disabled={!circleConfigured()} onClick={() => setView("email")}>
                        <span className="flex items-center gap-2">
                          <MailIcon /> continue with email
                        </span>
                        <Arrow />
                      </button>
                      <div className="flex items-center gap-3 py-1 font-display text-xs uppercase tracking-wide text-pengu-dark/40">
                        <span className="h-px flex-1 bg-pengu-dark/10" /> or <span className="h-px flex-1 bg-pengu-dark/10" />
                      </div>
                      <button className={pillGhost} disabled={wallet.disabled} onClick={wallet.onClick}>
                        <span className="flex items-center gap-2">
                          <WalletIcon /> {wallet.label}
                        </span>
                        <Arrow />
                      </button>
                    </div>
                    {!circleConfigured() ? (
                      <p className="mt-3 font-mono text-xs text-pengu-dark/45">set NEXT_PUBLIC_CIRCLE_CLIENT_KEY to enable email.</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-4">
                    <button
                      onClick={() => setView("choose")}
                      className="group inline-flex items-center gap-1 font-display text-xs uppercase tracking-wide text-pengu-blue"
                    >
                      <span className="transition-transform duration-150 group-hover:-translate-x-1">←</span> back
                    </button>
                    <h2 className="mt-2 font-bubble text-2xl uppercase text-pengu-dark">continue with email</h2>
                    <p className="mt-2 text-sm text-pengu-dark/65">
                      your email names a device passkey. no emailed code, no seed phrase. a gasless smart account is created for you.
                    </p>
                    <input
                      className="mt-4 w-full rounded-pill border border-pengu-dark/15 bg-white px-5 py-3 font-mono text-sm text-pengu-dark outline-none transition-colors focus:border-pengu-blue"
                      type="email"
                      placeholder="you@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={circleBusy}
                    />
                    <div className="mt-4 flex flex-col gap-3">
                      <button className={pillSolid} disabled={circleBusy} onClick={() => signInCircle("Register")}>
                        <span>{circleBusy ? "check your device" : "create account"}</span>
                        <Arrow />
                      </button>
                      <button className={pillGhost} disabled={circleBusy} onClick={() => signInCircle("Login")}>
                        <span>i have a passkey</span>
                        <span />
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {error ? <p className="mt-4 font-mono text-xs text-[#e0466e]">{error}</p> : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
