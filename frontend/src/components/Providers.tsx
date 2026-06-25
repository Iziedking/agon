"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider, type State } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { useState, type ReactNode } from "react";
import { config } from "@/lib/wagmi";
import { arcTestnet } from "@/lib/arc";
import { arcrunRainbowTheme } from "@/lib/rainbowTheme";
import { AuthProvider } from "@/hooks/useAuth";
import { SessionEndedToast } from "@/components/SessionEndedToast";

/// `initialState` is wagmi's connection state hydrated from the request cookies
/// in the root layout (cookieToInitialState). Passing it means a full page load
/// starts with the wallet ALREADY known, so reconnect is deterministic instead
/// of a cold client-side race. Every nav here is a full reload (plain <a>), so
/// without this each navigation flickered through "no wallet" long enough for
/// the stale-session detector to sign the user out.
export function Providers({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: State;
}) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        {/* RainbowKit supplies the branded wallet picker. initialChain points
            the modal at Arc so a freshly connected wallet defaults to the home
            chain. modalSize "compact" keeps it close to our own modal scale. */}
        <RainbowKitProvider
          theme={arcrunRainbowTheme}
          initialChain={arcTestnet}
          modalSize="compact"
          appInfo={{ appName: "ArcRun" }}
        >
          <AuthProvider>
            {children}
            {/* Surfaces a friendly toast when the auth context clears a
                stale wallet session, so the user understands why the
                login button reappeared. */}
            <SessionEndedToast />
          </AuthProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
