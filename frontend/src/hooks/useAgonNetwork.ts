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
  const search = searchParams.toString();
  const networkKey = getAgonNetworkKey(searchParams.get("network"));
  const network = useMemo(() => getAgonNetwork(networkKey), [networkKey]);

  const selectNetwork = useCallback((next: AgonNetworkKey) => {
    router.push(networkHref(pathname, next, search));
  }, [pathname, router, search]);

  return { network, networkKey, selectNetwork, defaultNetworkKey: AGON_DEFAULT_NETWORK_KEY };
}
