/// Type shims for the Circle Bridge Kit packages. Real types ship with the
/// modules once they're installed (`npm i @circle-fin/app-kit @circle-fin/adapter-viem-v2`).
/// Until then these declarations let the frontend typecheck while the bridge
/// page uses the SDK behind a dynamic import.
declare module "@circle-fin/app-kit" {
  export class AppKit {
    on(event: string, handler: (payload: unknown) => void): void;
    bridge(params: {
      from: { adapter: unknown; chain: string };
      to: { adapter: unknown; chain: string; useForwarder?: boolean; recipientAddress?: string };
      amount: string;
    }): Promise<{
      state?: string;
      steps?: Array<{ state: string; txHash?: string; explorerUrl?: string; name?: string }>;
    }>;
  }
}

declare module "@circle-fin/adapter-viem-v2" {
  export function createViemAdapterFromProvider(opts: { provider: unknown }): Promise<unknown>;
  export function createViemAdapterFromPrivateKey(opts: { privateKey: string }): unknown;
}
