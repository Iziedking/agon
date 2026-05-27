"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAccount, useChainId, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet } from "@/lib/arc";
import { loginWithSigner } from "@/lib/auth";
import { circleConfigured, createCircleAccount } from "@/lib/circle";
import { useAuth } from "@/hooks/useAuth";
import { Robot } from "@/components/redesign";
import { friendlyError } from "@/lib/errors";
import { reportEvent } from "@/lib/report";

/// Login popout, reskinned to arcrun-redesign. Bracketed surface on a warm
/// canvas, stencil heading, mono body, flat notched pink tag CTAs. Three
/// views: signed-out (choose between email passkey or wallet), email form,
/// and signed-in (account info plus a single SIGN OUT button that also
/// disconnects the wagmi wallet so the next click starts a fresh wallet
/// pick and a fresh SIWE signature). No rounded bubbles, no purple backdrop.

// Notched CTA shape — same clipPath the rest of the redesign uses.
const NOTCH = "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)";

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="0" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="0" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/// Click-to-copy address chip. Shows the short form, flips to "COPIED" for
/// a beat after a successful navigator.clipboard write.
function CopyAddress({ address, short }: { address: string; short: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard write can fail in insecure contexts; ignore silently
    }
  }
  return (
    <button
      onClick={copy}
      title={copied ? "copied" : `copy ${address}`}
      className="inline-flex items-center gap-1.5 border border-[color:var(--hairline-strong)] bg-canvas-2 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink transition-colors hover:bg-canvas-3"
    >
      <span>{copied ? "COPIED" : short}</span>
    </button>
  );
}

function PrimaryTag({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex w-full items-center justify-between gap-2 bg-accent px-4 py-3 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press disabled:opacity-60"
      style={{ clipPath: NOTCH }}
    >
      <span className="flex items-center gap-2">{children}</span>
      <span aria-hidden>→</span>
    </button>
  );
}

function GhostTag({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex w-full items-center justify-between gap-2 border border-ink bg-canvas px-4 py-3 font-mono text-[12px] uppercase tracking-[0.12em] text-ink transition-colors hover:bg-canvas-3 disabled:opacity-60"
    >
      <span className="flex items-center gap-2">{children}</span>
      <span aria-hidden>→</span>
    </button>
  );
}

function Bracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const base = {
    position: "absolute" as const,
    width: 14,
    height: 14,
    pointerEvents: "none" as const,
  };
  const ink = "var(--ink)";
  const styles: Record<typeof pos, React.CSSProperties> = {
    tl: { ...base, top: -1, left: -1, borderTop: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    tr: { ...base, top: -1, right: -1, borderTop: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
    bl: { ...base, bottom: -1, left: -1, borderBottom: `1.5px solid ${ink}`, borderLeft: `1.5px solid ${ink}` },
    br: { ...base, bottom: -1, right: -1, borderBottom: `1.5px solid ${ink}`, borderRight: `1.5px solid ${ink}` },
  };
  return <span aria-hidden style={styles[pos]} />;
}

export function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
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

  /// Full sign-out: clear the SIWE session AND disconnect the wagmi wallet.
  /// This is what the user expects "SIGN OUT" to mean. Without the disconnect,
  /// wagmi remembers the wallet and the next sign-in skips the wallet picker,
  /// which makes the flow feel sticky in a way that's confusing during demos.
  /// The modal closes after so the next click hits a clean "choose" view.
  async function handleSignOut() {
    try {
      await signOut();
    } finally {
      try { disconnect(); } catch { /* wagmi disconnect is non-throwing in practice */ }
      onClose();
    }
  }

  /// Same idea for "disconnect" when a wallet is connected but no SIWE
  /// session exists yet. Lets the user back out and pick a different wallet.
  function handleDisconnect() {
    try { disconnect(); } catch { /* ignore */ }
  }

  const wallet: { label: string; onClick?: () => void; disabled: boolean } = !mounted
    ? { label: "CONNECT A WALLET", disabled: true }
    : !isConnected
      ? { label: connecting ? "CHECK YOUR WALLET" : "CONNECT A WALLET", onClick: () => connect({ connector: injected() }), disabled: connecting }
      : chainId !== arcTestnet.id
        ? { label: "SWITCH TO ARC", onClick: () => switchChain({ chainId: arcTestnet.id }), disabled: false }
        : { label: busy ? "SIGNING" : "SIGN IN WITH WALLET", onClick: signInWeb3, disabled: busy };

  const short = me ? `${me.address.slice(0, 6)}…${me.address.slice(-4)}` : "";
  const contentKey = me ? "account" : view;
  const dur = reduce ? 0 : 0.24;
  const stepDur = reduce ? 0 : 0.16;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-modal overflow-y-auto"
          style={{ backgroundColor: "rgba(26,22,18,0.55)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          onClick={onClose}
        >
          <div className="flex min-h-full items-center justify-center px-4 py-12 sm:py-16" onClick={onClose}>
            <motion.div
              className="relative my-auto w-full max-w-[440px] border border-ink bg-canvas p-8"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: dur, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <Bracket pos="tl" /><Bracket pos="tr" /><Bracket pos="bl" /><Bracket pos="br" />

              <button
                onClick={onClose}
                aria-label="close"
                className="absolute right-4 top-4 font-mono text-base text-ink-3 transition-colors hover:text-ink"
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
                  {me ? (
                    <>
                      <div className="flex items-center gap-4">
                        <Robot variant="pink" size={56} decorative />
                        <div>
                          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                            <span aria-hidden className="text-accent">■</span> SIGNED IN
                          </div>
                          <h2
                            className="mt-1 font-stencil uppercase text-ink"
                            style={{ fontSize: 26, lineHeight: 1, letterSpacing: "-0.01em" }}
                          >
                            YOU ARE IN
                          </h2>
                        </div>
                      </div>
                      <div className="mt-5 flex items-center gap-2 font-mono text-[12px] text-ink-2">
                        <span>SIGNED IN AS</span>
                        <CopyAddress address={me.address} short={short} />
                      </div>
                      <div className="mt-7 flex flex-col gap-3">
                        <PrimaryTag onClick={onClose}>
                          <span>ENTER THE ARENA</span>
                        </PrimaryTag>
                        <GhostTag onClick={handleSignOut}>
                          <span>SIGN OUT &amp; DISCONNECT</span>
                        </GhostTag>
                      </div>
                      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                        SIGNING OUT CLEARS THE SESSION AND DISCONNECTS THE WALLET.
                      </p>
                    </>
                  ) : view === "choose" ? (
                    <>
                      <div className="flex items-center gap-4">
                        <Robot variant="pink" size={56} decorative />
                        <div>
                          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                            <span aria-hidden className="text-accent">■</span> SIGN IN
                          </div>
                          <h2
                            className="mt-1 font-stencil uppercase text-ink"
                            style={{ fontSize: 26, lineHeight: 1, letterSpacing: "-0.01em" }}
                          >
                            SIGN IN TO ARCRUN
                          </h2>
                        </div>
                      </div>
                      <p className="mt-4 font-mono text-[13px] leading-[1.55] text-ink-2">
                        two ways in. both give you an onchain identity to run agents and enter contests.
                      </p>
                      <div className="mt-6 flex flex-col gap-3">
                        <PrimaryTag disabled={!circleConfigured()} onClick={() => setView("email")}>
                          <MailIcon /> CONTINUE WITH EMAIL
                        </PrimaryTag>
                        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                          <span className="h-px flex-1 bg-[color:var(--hairline-strong)]" />
                          OR
                          <span className="h-px flex-1 bg-[color:var(--hairline-strong)]" />
                        </div>
                        <GhostTag disabled={wallet.disabled} onClick={wallet.onClick}>
                          <WalletIcon /> {wallet.label}
                        </GhostTag>
                        {isConnected ? (
                          <button
                            onClick={handleDisconnect}
                            className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 hover:text-ink"
                          >
                            DISCONNECT WALLET
                          </button>
                        ) : null}
                      </div>
                      {!circleConfigured() ? (
                        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                          SET NEXT_PUBLIC_CIRCLE_CLIENT_KEY TO ENABLE EMAIL.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-4">
                        <Robot variant="pink" size={56} decorative />
                        <div>
                          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
                            <span aria-hidden className="text-accent">■</span> EMAIL PASSKEY
                          </div>
                          <h2
                            className="mt-1 font-stencil uppercase text-ink"
                            style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-0.01em" }}
                          >
                            CONTINUE WITH EMAIL
                          </h2>
                        </div>
                      </div>
                      <p className="mt-4 font-mono text-[13px] leading-[1.55] text-ink-2">
                        your email names a device passkey. no emailed code, no seed phrase. a gasless smart account is created for you.
                      </p>
                      <input
                        className="mt-5 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2.5 font-mono text-sm text-ink outline-none transition-colors focus:border-ink"
                        type="email"
                        placeholder="you@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={circleBusy}
                      />
                      <div className="mt-4 flex flex-col gap-3">
                        <PrimaryTag disabled={circleBusy} onClick={() => signInCircle("Register")}>
                          <span>{circleBusy ? "CHECK YOUR DEVICE" : "CREATE ACCOUNT"}</span>
                        </PrimaryTag>
                        <GhostTag disabled={circleBusy} onClick={() => signInCircle("Login")}>
                          <span>I HAVE A PASSKEY</span>
                        </GhostTag>
                      </div>
                      <button
                        onClick={() => setView("choose")}
                        className="mt-5 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
                      >
                        ← BACK
                      </button>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>

              {error ? (
                <p className="mt-4 font-mono text-[11px] text-[color:var(--err)]">{error}</p>
              ) : null}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
