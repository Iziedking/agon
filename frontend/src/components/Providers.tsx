"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { Suspense, useState, type ReactNode } from "react";
import { config } from "@/lib/wagmi";
import { arcTestnet } from "@/lib/arc";
import { arcrunRainbowTheme } from "@/lib/rainbowTheme";
import { AuthProvider } from "@/hooks/useAuth";
import { SessionEndedToast } from "@/components/SessionEndedToast";
import { MissionAlert } from "@/components/MissionAlert";
import { AgonAccessGate } from "@/components/AgonAccessGate";
import { IS_AGON_DEPLOYMENT, PRODUCT_NAME } from "@/lib/product";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {/* RainbowKit supplies the branded wallet picker. Agon opens on BNB
            Mainnet; the legacy ArcRun deployment keeps Arc Testnet as home. */}
        <RainbowKitProvider
          theme={arcrunRainbowTheme}
          initialChain={IS_AGON_DEPLOYMENT ? undefined : arcTestnet}
          modalSize="compact"
          appInfo={{ appName: PRODUCT_NAME }}
        >
          <AuthProvider>
            <Suspense fallback={null}>
              <AgonAccessGate>{children}</AgonAccessGate>
            </Suspense>
            {/* Surfaces a friendly toast when the auth context clears a
                stale wallet session, so the user understands why the
                login button reappeared. */}
            <SessionEndedToast />
            {/* Site-wide popup when a new mission goes live. */}
            {IS_AGON_DEPLOYMENT ? null : <MissionAlert />}
          </AuthProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
