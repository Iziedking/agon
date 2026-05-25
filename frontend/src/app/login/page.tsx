"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useSignMessage, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet } from "@/lib/arc";
import { loginWithSigner } from "@/lib/auth";
import { circleConfigured, createCircleAccount } from "@/lib/circle";
import { useAuth } from "@/hooks/useAuth";

export default function LoginPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, isPending: connecting } = useConnect();
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { me, loading, refresh, signOut } = useAuth();

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

  return (
    <div className="wrap">
      <nav className="nav">
        <a className="wordmark" href="/">
          Arc<span>Run</span>
        </a>
      </nav>

      <div className="login">
        <h1>Sign in</h1>
        <p className="lead">Two ways in. Both give you an onchain identity to run agents and enter contests.</p>

        {me ? (
          <section className="card" style={{ marginTop: 24 }}>
            <div className="status">
              <div className="mono">
                Signed in as {me.address.slice(0, 6)}…{me.address.slice(-4)}
              </div>
              <div className="mono muted">
                X: {me.x_handle ?? "not linked (optional)"} · ready to compete: {me.canEnterContests ? "yes" : "no"}
              </div>
              <button className="btn btn-ghost" onClick={signOut}>
                Sign out
              </button>
            </div>
          </section>
        ) : (
          <div className="auth-grid">
            <section className="card">
              <div className="n">Web3 wallet</div>
              <h3>Connect a wallet</h3>
              <p>Use MetaMask or any injected wallet, then sign a free message to prove it is yours.</p>

              {!mounted ? (
                <button className="btn" disabled>
                  Connect Wallet
                </button>
              ) : !isConnected ? (
                <button className="btn" disabled={connecting} onClick={() => connect({ connector: injected() })}>
                  {connecting ? "Check your wallet..." : "Connect Wallet"}
                </button>
              ) : chainId !== arcTestnet.id ? (
                <button className="btn btn-warn" onClick={() => switchChain({ chainId: arcTestnet.id })}>
                  Switch to Arc Testnet
                </button>
              ) : (
                <button className="btn" disabled={busy} onClick={signInWeb3}>
                  {busy ? "Signing..." : "Sign in with wallet"}
                </button>
              )}
            </section>

            <section className="card">
              <div className="n">Email + passkey</div>
              <h3>No wallet needed</h3>
              <p>
                Your email names a device passkey, and your device approves the sign-in. No emailed code, no seed
                phrase. Circle Modular Wallets creates a gasless smart account for you.
              </p>
              <input
                className="field"
                type="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!circleConfigured() || circleBusy}
              />
              <div className="cta">
                <button
                  className="btn"
                  disabled={!circleConfigured() || circleBusy}
                  onClick={() => signInCircle("Register")}
                >
                  {circleBusy ? "Check your device..." : "Create account"}
                </button>
                <button
                  className="btn btn-outline"
                  disabled={!circleConfigured() || circleBusy}
                  onClick={() => signInCircle("Login")}
                >
                  I have a passkey
                </button>
              </div>
              {!circleConfigured() ? (
                <div className="mono muted">Set NEXT_PUBLIC_CIRCLE_CLIENT_KEY to enable this.</div>
              ) : null}
            </section>
          </div>
        )}

        {error ? <div className="mono err">{error}</div> : null}
        {loading ? <div className="mono muted">checking session...</div> : null}
      </div>
    </div>
  );
}
