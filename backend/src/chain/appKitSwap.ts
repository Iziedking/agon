import { config } from "../config/index.js";

/// Real same-chain DEX swaps on Arc through Circle App Kit Swap. Arc Testnet
/// supports USDC, EURC, and cirBTC. The Scout runner uses this to produce
/// genuine swap volume instead of self-transfers.
///
/// The App Kit packages are loaded with a dynamic import and the whole path
/// is gated behind SCOUT_REAL_SWAPS + CIRCLE_KIT_KEY, so the backend builds
/// and runs without the adapter installed; Scout simply self-transfers until
/// the operator installs @circle-fin/adapter-viem-v2 and sets the kit key.

export interface SwapResult {
  txHash: string;
  amountIn: string;
  amountOut: string;
}

let available: boolean | null = null;

/// True when real swaps are turned on and the kit key is set. The actual
/// package presence is checked lazily on the first swap.
export function swapEnabled(): boolean {
  return Boolean(config.scout.realSwaps && config.scout.kitKey);
}

/// One swap from a private-key-controlled wallet. Returns null when the path
/// is disabled or the adapter package isn't installed, so the caller can fall
/// back to self-transfers.
export async function executeSwap(opts: {
  privateKey: `0x${string}`;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
}): Promise<SwapResult | null> {
  if (!swapEnabled()) return null;

  let AppKit: typeof import("@circle-fin/app-kit").AppKit;
  let createViemAdapterFromPrivateKey: typeof import("@circle-fin/adapter-viem-v2").createViemAdapterFromPrivateKey;
  try {
    ({ AppKit } = await import("@circle-fin/app-kit"));
    ({ createViemAdapterFromPrivateKey } = await import("@circle-fin/adapter-viem-v2"));
    available = true;
  } catch {
    if (available !== false) {
      console.warn(
        "[scout-swap] SCOUT_REAL_SWAPS is on but @circle-fin/adapter-viem-v2 is not installed; " +
          "falling back to self-transfers. Run `npm i @circle-fin/adapter-viem-v2` in backend.",
      );
    }
    available = false;
    return null;
  }

  try {
    const adapter = await createViemAdapterFromPrivateKey({ privateKey: opts.privateKey } as never);
    const kit = new AppKit();
    const result = (await kit.swap({
      // Viem adapter signs from the key, so the address is omitted.
      from: { adapter, chain: "Arc_Testnet" as never },
      tokenIn: opts.tokenIn as never,
      tokenOut: opts.tokenOut as never,
      amountIn: opts.amountIn,
      config: { kitKey: config.scout.kitKey! },
    } as never)) as { txHash?: string; steps?: Array<{ txHash?: string }>; amountIn?: string; amountOut?: string };

    const txHash =
      result.txHash ??
      (result.steps ?? []).map((s) => s.txHash).filter(Boolean).at(-1) ??
      "";
    return {
      txHash,
      amountIn: result.amountIn ?? opts.amountIn,
      amountOut: result.amountOut ?? "0",
    };
  } catch (err) {
    console.warn(`[scout-swap] swap failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
