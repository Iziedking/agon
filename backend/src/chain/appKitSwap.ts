import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config/index.js";

/// Real same-chain DEX swaps on Arc through Circle Swap Kit (the Stablecoin
/// Service). Arc Testnet supports USDC, EURC, and cirBTC. The Scout runner
/// uses this to produce genuine swap volume instead of self-transfers, so the
/// arcscan tape shows real token-to-token swaps (USDC -> EURC and back).
///
/// The kit packages load via dynamic import and the whole path is gated behind
/// SCOUT_REAL_SWAPS + CIRCLE_KIT_KEY, so the backend builds and runs without
/// the adapter installed; Scout self-transfers until the operator installs
/// @circle-fin/swap-kit + @circle-fin/adapter-viem-v2 and sets the kit key.

export interface SwapResult {
  txHash: string;
  /// Input token amount, human-readable decimal string (e.g. "10.0").
  amountIn: string;
  /// Output token amount the swap produced, human-readable decimal string.
  /// Used to size the return leg (EURC -> USDC) off exactly what we received.
  amountOut: string;
}

let available: boolean | null = null;

/// True when real swaps are turned on and the kit key is set. The actual
/// package presence is checked lazily on the first swap.
export function swapEnabled(): boolean {
  return Boolean(config.scout.realSwaps && config.scout.kitKey);
}

/// One swap from a private-key-controlled wallet. Returns null when the path
/// is disabled or the kit packages aren't installed, so the caller can fall
/// back to self-transfers.
export async function executeSwap(opts: {
  privateKey: `0x${string}`;
  tokenIn: string;
  tokenOut: string;
  /// Human-readable decimal amount of `tokenIn` to swap (e.g. "10.0").
  amountIn: string;
}): Promise<SwapResult | null> {
  if (!swapEnabled()) return null;

  let swap: typeof import("@circle-fin/swap-kit").swap;
  let createSwapKitContext: typeof import("@circle-fin/swap-kit").createSwapKitContext;
  let SwapChain: typeof import("@circle-fin/swap-kit").SwapChain;
  let createViemAdapterFromPrivateKey: typeof import("@circle-fin/adapter-viem-v2").createViemAdapterFromPrivateKey;
  try {
    ({ swap, createSwapKitContext, SwapChain } = await import("@circle-fin/swap-kit"));
    ({ createViemAdapterFromPrivateKey } = await import("@circle-fin/adapter-viem-v2"));
    available = true;
  } catch {
    if (available !== false) {
      console.warn(
        "[scout-swap] SCOUT_REAL_SWAPS is on but @circle-fin/swap-kit / adapter-viem-v2 are not installed; " +
          "falling back to self-transfers. Run `npm i @circle-fin/swap-kit @circle-fin/adapter-viem-v2` in backend.",
      );
    }
    available = false;
    return null;
  }

  try {
    const account = privateKeyToAccount(opts.privateKey);
    // Pin every client the adapter builds to Arc's configured RPC so the swap
    // broadcasts through the same node as the rest of the backend. The zero
    // config adapter would otherwise use viem's default Arc RPC, which may
    // differ from a paid or regional endpoint set in CHAIN_RPC_HTTP.
    // The cast targets the factory's own parameter type: the adapter bundles
    // its own viem build, so our viem's PublicClient/WalletClient are
    // structurally identical but nominally distinct. The callbacks still run
    // with a real viem Chain and return real clients at runtime.
    const adapterParams = {
      privateKey: opts.privateKey,
      getPublicClient: ({ chain }: { chain: Chain }) =>
        createPublicClient({ chain, transport: http(config.rpcHttp) }),
      getWalletClient: ({ chain }: { chain: Chain }) =>
        createWalletClient({ account, chain, transport: http(config.rpcHttp) }),
    } as unknown as Parameters<typeof createViemAdapterFromPrivateKey>[0];
    const adapter = createViemAdapterFromPrivateKey(adapterParams);

    const context = createSwapKitContext();
    const result = await swap(context, {
      // The viem adapter signs from the private key, so the from-address is
      // implicit. EURC and USDC both expose EIP-2612, so the default 'permit'
      // allowance strategy spares an extra approval tx on most legs.
      // swap-kit's Adapter and adapter-viem-v2's ViemAdapter are structurally
      // the same shape but nominally distinct types across the two packages.
      from: { adapter: adapter as never, chain: SwapChain.Arc_Testnet },
      tokenIn: opts.tokenIn as never,
      tokenOut: opts.tokenOut as never,
      amountIn: opts.amountIn,
      // kitKey is validated by swap-kit's params schema and forwarded to the
      // Stablecoin Service provider; the public SwapConfig type omits it, so
      // the cast keeps the field without loosening the rest of the call.
      // Slippage is env-tunable: the Arc testnet USDC<->EURC pool is thin, so a
      // larger swap moves the price more and a tight 3% band reverts the sim.
      // 5% by default; pair this with a small SCOUT_SWAP_MAX_USDC per swap.
      config: {
        kitKey: config.scout.kitKey!,
        slippageBps: Number(process.env.SCOUT_SWAP_SLIPPAGE_BPS ?? "500"),
      } as never,
    });

    return {
      txHash: result.txHash ?? "",
      amountIn: result.amountIn ?? opts.amountIn,
      amountOut: result.amountOut ?? "0",
    };
  } catch (err) {
    // Include the size + pair so a revert is diagnosable. swap-kit wraps the
    // underlying viem error and only surfaces "Transaction reverted", which
    // hides WHY (route has no liquidity, permit rejected, transfer-from failed,
    // slippage). Dig the cause chain for the real reason so a failure is
    // actionable instead of opaque.
    const reason = (() => {
      const parts: string[] = [];
      let cur: unknown = err;
      let depth = 0;
      while (cur && depth < 6) {
        const e = cur as { shortMessage?: string; message?: string; details?: string; metaMessages?: string[]; cause?: unknown };
        if (e.shortMessage && !parts.includes(e.shortMessage)) parts.push(e.shortMessage);
        if (e.details && !parts.includes(e.details)) parts.push(e.details);
        if (Array.isArray(e.metaMessages)) parts.push(...e.metaMessages);
        cur = e.cause;
        depth += 1;
      }
      if (parts.length === 0 && err instanceof Error) parts.push(err.message);
      return parts.join(" | ");
    })();
    console.warn(
      `[scout-swap] swap failed (${opts.amountIn} ${opts.tokenIn}->${opts.tokenOut}): ${reason}`,
    );
    return null;
  }
}
