"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccount, useReconnect } from "wagmi";
import { fetchMe, logout, purgeLegacyToken, type Me } from "@/lib/auth";

/// Tracks the current ArcRun session. The session itself lives in an httpOnly
/// cookie set by the backend, so this hook never touches localStorage. On
/// mount it purges any pre-cookie token left over from older app versions,
/// then asks the auth service who we are.
///
/// Auth state is held in a React context so every consumer (TopNav button,
/// LoginModal, workshop, dashboard, anywhere) reads from the same source.
/// Before this was a context, each useAuth() call ran its own useState which
/// meant a sign-out in the modal didn't propagate to the nav until the next
/// page refresh; the workshop also gated on wagmi.isConnected only, which is
/// always false for Circle passkey users since they have no injected wallet.
/// Both bugs collapse into one fix: shared state via AuthProvider.
///
/// Stale-session handling for web3 (wagmi) users:
/// On mount we ask wagmi to reconnect from its stored connector state. If
/// wagmi settles disconnected and the cookie still says the user is signed
/// in via wagmi, the session is stale (browser was closed, wallet popup is
/// gone). We clear the cookie so the UI shows a clean "sign in" rather
/// than appearing logged in while every protected action silently fails.
/// Circle (email/passkey) users are unaffected because their writes go
/// through /wallet/execute, not a connected wallet.

interface AuthContextValue {
  me: Me | null;
  loading: boolean;
  /// True for the brief window between mount and wagmi finishing its
  /// reconnect attempt. UI should hold its "is the user signed in"
  /// decision until this clears, to avoid flashing between states.
  settling: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /// Set to a short message when the stale-session detector signs the
  /// user out, so UI surfaces can show a friendly toast / banner instead
  /// of silently returning to the logged-out state.
  sessionEndedReason: string | null;
  clearSessionEndedReason: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionEndedReason, setSessionEndedReason] = useState<string | null>(null);
  const { address: wallet, status } = useAccount();
  const { reconnect } = useReconnect();
  const reconnectKicked = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMe(await fetchMe());
    setLoading(false);
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setMe(null);
  }, []);

  // Boot: clean any legacy token, kick wagmi's reconnect attempt against
  // its stored connector state, then ask the auth service for the
  // current session. The reconnect is idempotent; wagmi returns
  // immediately when there's nothing to reconnect to.
  useEffect(() => {
    purgeLegacyToken();
    if (!reconnectKicked.current) {
      reconnectKicked.current = true;
      try {
        reconnect();
      } catch {
        // Reconnect can throw on the first call if no connectors are
        // configured yet; safe to ignore. Worst case the user clicks
        // CONNECT manually.
      }
    }
    void refresh();
  }, [refresh, reconnect]);

  // Stale-session detector + cross-account check.
  // Runs every time `me`, `wallet`, or wagmi `status` changes. Bails
  // until wagmi has settled its initial reconnect (status !== connecting
  // and !== reconnecting) so we don't sign the user out during the
  // ~200ms boot window.
  useEffect(() => {
    if (!me) return;
    if (status === "connecting" || status === "reconnecting") return;

    // For wagmi-backed sessions: a disconnected wallet after wagmi has
    // settled means the SIWE session is unusable for signing. Clear it
    // so the UI shows a clean sign-in CTA instead of a logged-in shell
    // whose writes will all fail.
    if (me.walletKind === "wagmi" && !wallet) {
      setSessionEndedReason("your wallet isn't connected anymore. sign in to continue.");
      void signOut();
      return;
    }

    // Cross-account check (existing): different wallet connected than
    // the session expected → sign out so the backend doesn't keep
    // acting as the previous account.
    if (wallet && me.address.toLowerCase() !== wallet.toLowerCase()) {
      setSessionEndedReason("you switched wallet accounts. sign in with the new one.");
      void signOut();
    }
  }, [me, wallet, status, signOut]);

  const settling = status === "connecting" || status === "reconnecting" || loading;

  const clearSessionEndedReason = useCallback(() => setSessionEndedReason(null), []);

  return (
    <AuthContext.Provider
      value={{ me, loading, settling, refresh, signOut, sessionEndedReason, clearSessionEndedReason }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/// Returns the operator's effective address from EITHER an injected wallet
/// connection OR an active SIWE session. Use this in any UI that needs to
/// know "is someone signed in, and which address" without caring whether
/// they came in through wagmi or Circle passkey.
///
/// `isSignedIn` is true ONLY when there's a usable identity for the
/// session's wallet kind:
///   - Circle users: session cookie alone is enough (writes go through
///     /wallet/execute server-side, no wagmi needed).
///   - wagmi users: cookie AND wagmi is currently connected.
/// Without this distinction, a wagmi user with a stale cookie would
/// appear signed-in while every protected action fails silently.
export function useOperatorAddress(): {
  address: `0x${string}` | undefined;
  isSignedIn: boolean;
} {
  const { me } = useAuth();
  const { address: walletAddress, isConnected: walletConnected } = useAccount();
  const address = (walletAddress ?? me?.address) as `0x${string}` | undefined;
  // Circle: cookie is the auth. wagmi: cookie AND connected wallet.
  const isCircle = me?.walletKind === "circle";
  const isSignedIn = isCircle ? !!me?.address : walletConnected && !!me?.address;
  return { address, isSignedIn };
}
