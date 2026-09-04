"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { usePathname } from "next/navigation";
import { fetchMe, logout, purgeLegacyToken, type Me } from "@/lib/auth";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { IS_AGON_DEPLOYMENT } from "@/lib/product";
import { isAgonRoute } from "@/lib/agon/routes";
import { bnbMe, bnbLogout } from "@agon/bnb/client";
import type { BnbChain } from "@agon/bnb/types";

interface AuthContextValue {
  me: Me | null; loading: boolean; settling: boolean;
  refresh: () => Promise<void>; signOut: () => Promise<void>;
  sessionEndedReason: string | null; clearSessionEndedReason: () => void; siwePrompting: boolean;
}
const AuthContext = createContext<AuthContextValue | null>(null);

/** A cookie never authenticates a different network. Only explicit sign-in
 * requests a signature; public browsing never does. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { network } = useAgonNetwork();
  const pathname = usePathname() ?? "/";
  const agon = IS_AGON_DEPLOYMENT || isAgonRoute(pathname);
  const bnb = agon && (network.chainId === 56 || network.chainId === 97) ? network.chainId as BnbChain : null;
  const scope = bnb ?? 5042002;
  const [state, setState] = useState<{ scope: number; me: Me | null; loading: boolean }>({ scope, me: null, loading: true });
  const [sessionEndedReason, setSessionEndedReason] = useState<string | null>(null);
  const { address: wallet, status } = useAccount();
  const generation = useRef(0);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const me = state.scope === scope ? state.me : null;
  const loading = state.scope !== scope || state.loading;
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, me: null, loading: true });
    let next: Me | null = null;
    try {
      if (bnb) {
        const { session } = await bnbMe(bnb);
        if (session) next = { address: session.address, x_handle: null, current_syndicate_id: null, walletKind: "wagmi", canEnterContests: false };
      } else next = await fetchMe();
    } catch { /* Never carry a previous network identity through a failure. */ }
    if (request === generation.current && activeScope.current === scope) setState({ scope, me: next, loading: false });
  }, [bnb, scope]);
  const signOut = useCallback(async () => {
    ++generation.current;
    setState({ scope, me: null, loading: false });
    if (bnb) await bnbLogout(bnb); else await logout();
  }, [bnb, scope]);
  useEffect(() => { purgeLegacyToken(); void refresh(); return () => { ++generation.current; }; }, [refresh]);
  useEffect(() => {
    if (me?.walletKind === "wagmi" && wallet && status === "connected" && wallet.toLowerCase() !== me.address.toLowerCase()) {
      setSessionEndedReason("You switched wallet accounts. Sign in with the new one.");
      void signOut().catch(() => {});
    }
  }, [me, wallet, status, signOut]);
  const clearSessionEndedReason = useCallback(() => setSessionEndedReason(null), []);
  return <AuthContext.Provider value={{ me, loading, settling: loading || status === "reconnecting", refresh, signOut, sessionEndedReason, clearSessionEndedReason, siwePrompting: false }}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
export function useOperatorAddress(): { address: `0x${string}` | undefined; isSignedIn: boolean; settling: boolean } {
  const { me, settling } = useAuth();
  const { address: wallet } = useAccount();
  return { address: (me?.address ?? wallet) as `0x${string}` | undefined, isSignedIn: !!me, settling };
}
