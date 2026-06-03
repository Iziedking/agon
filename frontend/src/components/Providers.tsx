"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { config } from "@/lib/wagmi";
import { AuthProvider } from "@/hooks/useAuth";
import { SessionEndedToast } from "@/components/SessionEndedToast";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {children}
          {/* Surfaces a friendly toast when the auth context clears a
              stale wallet session, so the user understands why the
              login button reappeared. */}
          <SessionEndedToast />
        </AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
