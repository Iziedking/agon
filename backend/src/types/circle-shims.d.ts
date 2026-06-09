/// Type shims for Circle App Kit packages on the backend. Real types ship
/// from @circle-fin/app-kit and @circle-fin/adapter-circle-wallets once
/// docker installs them. Until then these declarations let the backend
/// typecheck while circleBridge.ts uses them through dynamic imports.

declare module "@circle-fin/app-kit" {
  export class AppKit {
    on(event: string, handler: (payload: unknown) => void): void;
    bridge(params: {
      from: { adapter: unknown; chain: string };
      to: {
        adapter?: unknown;
        chain: string;
        useForwarder?: boolean;
        recipientAddress?: string;
      };
      amount: string;
    }): Promise<{
      state?: string;
      steps?: Array<{ name?: string; state?: string; txHash?: string; explorerUrl?: string }>;
    }>;
  }
}

declare module "@circle-fin/adapter-circle-wallets" {
  export function createCircleWalletsAdapter(opts: {
    apiKey: string;
    entitySecret: string;
  }): unknown;
}
