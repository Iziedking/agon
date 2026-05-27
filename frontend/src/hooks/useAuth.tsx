"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAccount } from "wagmi";
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
/// Also enforces wallet-vs-session consistency: if the connected wagmi
/// address is different from the SIWE session address (the user switched
/// accounts in their wallet), the stale cookie is cleared. The user has to
/// re-SIWE as the new wallet on the next protected action; this avoids the
/// "cooldown / ownership rejected" mystery where the backend was still
/// acting as the previous account.

interface AuthContextValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const { address: wallet } = useAccount();

  const refresh = useCallback(async () => {
    setLoading(true);
    setMe(await fetchMe());
    setLoading(false);
  }, []);

  useEffect(() => {
    purgeLegacyToken();
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await logout();
    setMe(null);
  }, []);

  useEffect(() => {
    if (!me || !wallet) return;
    if (me.address.toLowerCase() !== wallet.toLowerCase()) {
      void signOut();
    }
  }, [me, wallet, signOut]);

  return (
    <AuthContext.Provider value={{ me, loading, refresh, signOut }}>
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
/// `isSignedIn` is true when the user has any usable identity. `address` is
/// the wallet address when wagmi is connected (preferred so on-chain reads
/// match the user's own wallet view), otherwise the SIWE session address.
export function useOperatorAddress(): {
  address: `0x${string}` | undefined;
  isSignedIn: boolean;
} {
  const { me } = useAuth();
  const { address: walletAddress, isConnected: walletConnected } = useAccount();
  const address = (walletAddress ?? me?.address) as `0x${string}` | undefined;
  return { address, isSignedIn: walletConnected || !!me?.address };
}
