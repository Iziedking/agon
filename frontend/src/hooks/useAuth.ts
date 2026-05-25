"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMe, tokenStore, type Me } from "@/lib/auth";

/// Tracks the current ArcRun session (the JWT and the operator profile).
export function useAuth() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = tokenStore.get();
    if (!token) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await fetchMe(token));
    } catch {
      tokenStore.clear();
      setMe(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setMe(null);
  }, []);

  return { me, loading, refresh, signOut };
}
