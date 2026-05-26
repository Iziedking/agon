"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMe, logout, purgeLegacyToken, type Me } from "@/lib/auth";

/// Tracks the current ArcRun session. The session itself lives in an httpOnly
/// cookie set by the backend, so this hook never touches localStorage. On mount
/// it purges any pre-cookie token left over from older app versions, then asks
/// the auth service who we are.
export function useAuth() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

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

  return { me, loading, refresh, signOut };
}
