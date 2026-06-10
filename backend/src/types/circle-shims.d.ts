/// Type shims for Circle App Kit packages on the backend. Real types ship
/// from @circle-fin/app-kit and @circle-fin/adapter-circle-wallets when the
/// packages are installed; these declarations let the backend typecheck
/// while circleBridge.ts uses them through dynamic imports.

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
    swap(params: {
      from: { adapter: unknown; chain: string; address?: string };
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      config?: { kitKey?: string };
    }): Promise<{
      txHash?: string;
      amountIn?: string;
      amountOut?: string;
      steps?: Array<{ txHash?: string }>;
    }>;
  }
}

declare module "@circle-fin/adapter-circle-wallets" {
  export function createCircleWalletsAdapter(opts: {
    apiKey: string;
    entitySecret: string;
  }): unknown;
}

declare module "@circle-fin/adapter-viem-v2" {
  export function createViemAdapterFromPrivateKey(opts: { privateKey: string }): Promise<unknown>;
  export function createViemAdapterFromProvider(opts: { provider: unknown }): Promise<unknown>;
}
