"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAccount, useChainId, useConnect, useSignMessage, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet } from "@/lib/arc";
import { loginWithSigner } from "@/lib/auth";
import { circleConfigured, createCircleAccount } from "@/lib/circle";
import { useAuth } from "@/hooks/useAuth";
import { AgentMascot } from "@/components/pengu/AgentMascot";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";

// Thick, pressable "chunky" buttons: a solid drop edge underneath that
// compresses when pressed. This is the Pengu game-button feel, not a flat pill.
const solid =
  "group flex w-full items-center justify-between rounded-pill bg-pengu-blue px-6 py-4 font-display text-base uppercase tracking-wide text-white shadow-[0_5px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_3px_0_0_#5b34d6] active:translate-y-[4px] active:shadow-[0_1px_0_0_#5b34d6] disabled:opacity-60";
const ghost =
  "group flex w-full items-center justify-between rounded-pill border-2 border-pengu-blue bg-white px-6 py-4 font-display text-base uppercase tracking-wide text-pengu-blue shadow-[0_5px_0_0_#e3dbff] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_3px_0_0_#e3dbff] active:translate-y-[4px] disabled:opacity-60";
const ghostCenter =
  "flex w-full items-center justify-center rounded-pill border-2 border-pengu-blue bg-white px-6 py-4 font-display text-base uppercase tracking-wide text-pengu-blue shadow-[0_5px_0_0_#e3dbff] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_3px_0_0_#e3dbff] active:translate-y-[4px] disabled:opacity-60";

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function GoCircle({ bg }: { bg: string }) {
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${bg} transition-transform duration-150 group-hover:translate-x-0.5`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </span>
  );
}

/// The login popout: an animated, chunky ArcRun modal. Pick a path (email
/// passkey or wallet). Reuses the SIWE plus Circle auth logic.
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
      reportEvent("login", { context: { method: "wallet" } });
    } catch (e) {
      setError(friendlyError(e, "sign in failed."));
      reportEvent("login_error", {
        level: "error",
        message: e instanceof Error ? e.message : String(e),
        context: { method: "wallet" },
      });
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
      reportEvent("login", { context: { method: "email", mode } });
    } catch (e) {
      setError(friendlyError(e, "passkey login failed."));
      reportEvent("login_error", {
        level: "error",
        message: e instanceof Error ? e.message : String(e),
        context: { method: "email", mode },
      });
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
            className="relative w-full max-w-[420px] rounded-[28px] border-2 border-pengu-dark/5 bg-white p-8 text-center shadow-[0_30px_80px_rgba(27,17,64,0.35)]"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: dur, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              aria-label="close"
              className="absolute right-5 top-5 text-xl leading-none text-pengu-dark/30 transition-colors hover:text-pengu-dark"
            >
              ✕
            </button>

            <AnimatePresence mode="wait">
              <motion.div
                key={contentKey}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: stepDur, ease: [0.16, 1, 0.3, 1] }}
              >
                <AgentMascot color="#7c4dff" className="mx-auto h-16 w-auto" />

                {me ? (
                  <>
                    <h2 className="mt-4 font-bubble text-3xl uppercase leading-none text-pengu-dark">you are in</h2>
                    <p className="mt-2 font-mono text-sm text-pengu-dark/70">signed in as {short}</p>
                    <div className="mt-7 flex flex-col gap-4">
                      <a href="/contests" className={solid}>
                        <span>enter the arena</span>
                        <GoCircle bg="bg-white/25" />
                      </a>
                      <button className={ghostCenter} onClick={signOut}>
                        sign out
                      </button>
                    </div>
                  </>
                ) : view === "choose" ? (
                  <>
                    <h2 className="mt-4 font-bubble text-3xl uppercase leading-none text-pengu-dark">sign in to arcrun</h2>
                    <p className="mx-auto mt-3 max-w-[34ch] text-sm text-pengu-dark/65">
                      two ways in. both give you an onchain identity to run agents and enter contests.
                    </p>
                    <div className="mt-7 flex flex-col gap-4">
                      <button className={solid} disabled={!circleConfigured()} onClick={() => setView("email")}>
                        <span className="flex items-center gap-2">
                          <MailIcon /> continue with email
                        </span>
                        <GoCircle bg="bg-white/25" />
                      </button>
                      <div className="flex items-center gap-3 font-display text-xs uppercase tracking-wide text-pengu-dark/40">
                        <span className="h-px flex-1 bg-pengu-dark/10" /> or <span className="h-px flex-1 bg-pengu-dark/10" />
                      </div>
                      <button className={ghost} disabled={wallet.disabled} onClick={wallet.onClick}>
                        <span className="flex items-center gap-2">
                          <WalletIcon /> {wallet.label}
                        </span>
                        <GoCircle bg="bg-pengu-blue/10" />
                      </button>
                    </div>
                    {!circleConfigured() ? (
                      <p className="mt-4 font-mono text-xs text-pengu-dark/45">set NEXT_PUBLIC_CIRCLE_CLIENT_KEY to enable email.</p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <h2 className="mt-4 font-bubble text-3xl uppercase leading-none text-pengu-dark">continue with email</h2>
                    <p className="mx-auto mt-3 max-w-[36ch] text-sm text-pengu-dark/65">
                      your email names a device passkey. no emailed code, no seed phrase. a gasless smart account is created for you.
                    </p>
                    <input
                      className="mt-5 w-full rounded-pill border-2 border-pengu-dark/15 bg-white px-5 py-3.5 text-left font-mono text-sm text-pengu-dark outline-none transition-colors focus:border-pengu-blue"
                      type="email"
                      placeholder="you@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={circleBusy}
                    />
                    <div className="mt-4 flex flex-col gap-4">
                      <button className={solid} disabled={circleBusy} onClick={() => signInCircle("Register")}>
                        <span>{circleBusy ? "check your device" : "create account"}</span>
                        <GoCircle bg="bg-white/25" />
                      </button>
                      <button className={ghostCenter} disabled={circleBusy} onClick={() => signInCircle("Login")}>
                        i have a passkey
                      </button>
                    </div>
                    <button
                      onClick={() => setView("choose")}
                      className="group mt-5 inline-flex items-center gap-1 font-display text-xs uppercase tracking-wide text-pengu-dark/50 hover:text-pengu-dark"
                    >
                      <span className="transition-transform duration-150 group-hover:-translate-x-1">←</span> back
                    </button>
                  </>
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
