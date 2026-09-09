"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  AGON_DEFAULT_NETWORK_KEY,
  getAgonNetwork,
  getAgonNetworkKey,
  networkHref,
  type AgonNetworkKey,
} from "@/lib/agon/network";

/**
 * Reads the network from the URL so a shared listing, receipt, or demo link
 * cannot silently change meaning when opened on another chain.
 */
export function useAgonNetwork() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const searchParams = useSearchParams();
  const networkKey = getAgonNetworkKey(searchParams.get("network"));
  const network = useMemo(() => getAgonNetwork(networkKey), [networkKey]);

  const selectNetwork = useCallback((next: AgonNetworkKey) => {
    // Agent IDs and prepared requests are network-specific. Return to discovery
    // instead of carrying a request or comparison into a different chain.
    router.push(networkHref(pathname.startsWith("/market") || pathname.startsWith("/agon/playground") ? "/market" : pathname, next));
  }, [pathname, router]);

  return { network, networkKey, selectNetwork, defaultNetworkKey: AGON_DEFAULT_NETWORK_KEY };
}
