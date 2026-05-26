"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { fetchMe, logout, purgeLegacyToken, type Me } from "@/lib/auth";

/// Tracks the current ArcRun session. The session itself lives in an httpOnly
/// cookie set by the backend, so this hook never touches localStorage. On mount
/// it purges any pre-cookie token left over from older app versions, then asks
/// the auth service who we are.
///
/// Also enforces wallet-vs-session consistency: if the connected wagmi address
/// is different from the SIWE session address (because the user switched
/// accounts in their wallet), the stale cookie is cleared. The user has to
/// re-SIWE as the new wallet on the next protected action; this avoids the
/// "cooldown / ownership rejected" mystery where the backend was still acting
/// as the previous account.
export function useAuth() {
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

  // Auto-sign-out when the wallet diverges from the session address.
  useEffect(() => {
    if (!me || !wallet) return;
    if (me.address.toLowerCase() !== wallet.toLowerCase()) {
      void signOut();
    }
  }, [me, wallet, signOut]);

  return { me, loading, refresh, signOut };
}
