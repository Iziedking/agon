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

/// Why real swaps are OFF, or null when they are on.
///
/// This exists because of a trap that cost us the whole Scout contest type. The
/// old check was `Boolean(realSwaps && kitKey)`. A deploy that copied
/// `deploy/.env.example` verbatim carries `CIRCLE_KIT_KEY=<fill in kit key>`,
/// which is a NON-EMPTY string, so the gate passed, the swap was attempted, Swap
/// Kit rejected the key, executeSwap caught the error and returned null, and the
/// runner quietly self-transferred instead. Forever. An on-chain audit of the
/// agent hot wallets found ZERO swaps and nothing but transfers, while the logs
/// said nothing louder than a console.warn.
///
/// So: validate the SHAPE of the key, and give the caller a reason it can print.
export function swapDisabledReason(): string | null {
  if (!config.scout.realSwaps) return "SCOUT_REAL_SWAPS is not set";
  const key = config.scout.kitKey;
  if (!key) return "CIRCLE_KIT_KEY is not set";
  if (!/^KIT_KEY:[^:\s]+:[^:\s]+$/.test(key)) {
    return `CIRCLE_KIT_KEY is malformed. Expected KIT_KEY:<id>:<secret>, got "${key.slice(0, 14)}..." ` +
      `(a placeholder like <fill in kit key> counts as malformed)`;
  }
  return null;
}

/// True when real swaps are turned on AND the kit key is well-formed. The package
/// presence is still checked lazily on the first swap.
export function swapEnabled(): boolean {
  return swapDisabledReason() === null;
}

/// Say once, at boot, whether real swaps are actually live. A misconfigured deploy
/// must be visible in the container logs, not discovered weeks later by reading
/// the explorer.
export function logSwapStatus(): void {
  const why = swapDisabledReason();
  if (why) {
    console.warn(
      `[scout-swap] REAL SWAPS ARE OFF: ${why}.\n` +
        `[scout-swap] Scout will fall back to USDC self-transfers, which still produce volume ` +
        `but are NOT swaps. Fix the env to get real ${config.scout.swapTokenIn} -> ${config.scout.swapTokenOut} swaps.`,
    );
    return;
  }
  const maxUsdc = Number(process.env.SCOUT_SWAP_MAX_USDC ?? "10");
  console.log(
    `[scout-swap] real swaps ON: ${config.scout.swapTokenIn} <-> ${config.scout.swapTokenOut} on Arc, ` +
      `slippage ${process.env.SCOUT_SWAP_SLIPPAGE_BPS ?? "500"} bps, max ${maxUsdc} USDC/swap ` +
      `(tier sizes ${config.scout.swapSizeByTier.join("/")})`,
  );
  // The pool is the real limit, not the config. A round trip fills up to about
  // 10 USDC on Arc Testnet and has no route at 15+. Anything sized above that
  // cannot fill and silently degrades into a self-transfer, which is how a whole
  // VOLUME challenge once settled with zero swaps in it. Say so at boot.
  const MEASURED_POOL_DEPTH_USDC = 10;
  const overCap = config.scout.swapSizeByTier.filter((n) => n > maxUsdc);
  if (maxUsdc > MEASURED_POOL_DEPTH_USDC) {
    console.warn(
      `[scout-swap] WARNING: SCOUT_SWAP_MAX_USDC=${maxUsdc} is above the measured pool depth ` +
        `(~${MEASURED_POOL_DEPTH_USDC} USDC round trip). Swaps that big have NO ROUTE and will fall back to ` +
        `self-transfers. Re-measure with scripts/swap-depth-probe.ts before raising it.`,
    );
  }
  if (overCap.length > 0) {
    console.warn(
      `[scout-swap] WARNING: tier size(s) ${overCap.join(", ")} exceed SCOUT_SWAP_MAX_USDC=${maxUsdc}. ` +
        `Those tiers get clamped, so their whale traits pay out as extra legs instead of bigger trades.`,
    );
  }
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
      // Slippage is env-tunable. Swaps DO fill on Arc Testnet (a probe swapped
      // 1.0 USDC -> 0.908261 EURC and back, both legs on chain), but the pool is
      // shallow enough that a larger swap moves the price and a tight 3% band
      // reverts the sim. 5% by default; pair it with a small SCOUT_SWAP_MAX_USDC.
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

/// Try a swap, and on a routing failure HALVE it and try again, down to
/// `minAmountIn`. Returns the swap that landed (at whatever size actually
/// filled), or null when even the smallest size could not route.
///
/// This exists because Arc Testnet's USDC/EURC pool is shallow and the
/// aggregator is flaky at the top of its band. Measured with swap-depth-probe:
/// a USDC -> EURC -> USDC round trip fills up to about 10 USDC, NOTHING at 15 or
/// above routes at all, and sizes near 8-10 go routeless intermittently (the
/// same 7.9 EURC leg returned "no route" on one probe and filled on the next).
///
/// The runner used to fire one swap at its full requested size and, on failure,
/// fall straight through to a USDC self-transfer. With SCOUT_SWAP_MAX_USDC
/// defaulting to 100, a trait-boosted agent asked for ~90 USDC per swap, every
/// swap missed, and every op landed on the tape as a `transfer`. A whole VOLUME
/// challenge settled with zero real swaps in it.
///
/// So shrink instead of surrender. A smaller REAL swap beats a self-transfer.
export async function executeSwapShrinking(opts: {
  privateKey: `0x${string}`;
  tokenIn: string;
  tokenOut: string;
  /// Human-readable amount of `tokenIn` to try first.
  amountIn: number;
  /// Floor: below this the gas costs more than the trade is worth.
  minAmountIn?: number;
  /// How many halvings to try before giving up.
  maxAttempts?: number;
}): Promise<SwapResult | null> {
  const min = opts.minAmountIn ?? 0.25;
  const maxAttempts = opts.maxAttempts ?? 5;
  let amount = opts.amountIn;

  for (let attempt = 0; attempt < maxAttempts && amount >= min; attempt++) {
    const res = await executeSwap({
      privateKey: opts.privateKey,
      tokenIn: opts.tokenIn,
      tokenOut: opts.tokenOut,
      amountIn: amount.toFixed(6),
    });
    if (res?.txHash) {
      if (attempt > 0) {
        console.log(
          `[scout-swap] filled at ${amount.toFixed(4)} ${opts.tokenIn} after shrinking from ` +
            `${opts.amountIn.toFixed(4)} (${attempt} halving${attempt === 1 ? "" : "s"})`,
        );
      }
      return res;
    }
    amount /= 2;
  }

  console.warn(
    `[scout-swap] no route for ${opts.tokenIn}->${opts.tokenOut} at any size from ` +
      `${opts.amountIn.toFixed(4)} down to ${min}; caller will fall back`,
  );
  return null;
}

/// Read-only diagnostic: ask the aggregator whether a fillable route EXISTS for
/// this pair on Arc, without sending anything. Circle's swap routes through a
/// third-party DEX aggregator (currently LiFi), so a swap reverts when LiFi
/// cannot build a route over the on-chain liquidity. `estimate` returns the
/// route and expected output when one exists, or throws with the reason when it
/// does not. `npm run swap:probe` prints this verdict so we stop guessing why a
/// swap reverts: a returned estimate means the revert is tunable (slippage /
/// permit); a thrown "no route" means there is no USDC/EURC liquidity for LiFi
/// to use on Arc testnet, and a real swap is impossible until there is.
export async function estimateSwap(opts: {
  privateKey: `0x${string}`;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
}): Promise<{ ok: boolean; raw?: unknown; reason?: string }> {
  if (!swapEnabled()) {
    return { ok: false, reason: "swaps disabled (SCOUT_REAL_SWAPS / CIRCLE_KIT_KEY not set)" };
  }
  let estimate: typeof import("@circle-fin/swap-kit").estimate;
  let createSwapKitContext: typeof import("@circle-fin/swap-kit").createSwapKitContext;
  let SwapChain: typeof import("@circle-fin/swap-kit").SwapChain;
  let createViemAdapterFromPrivateKey: typeof import("@circle-fin/adapter-viem-v2").createViemAdapterFromPrivateKey;
  try {
    ({ estimate, createSwapKitContext, SwapChain } = await import("@circle-fin/swap-kit"));
    ({ createViemAdapterFromPrivateKey } = await import("@circle-fin/adapter-viem-v2"));
  } catch {
    return { ok: false, reason: "@circle-fin/swap-kit / adapter-viem-v2 not installed" };
  }
  try {
    const account = privateKeyToAccount(opts.privateKey);
    const adapterParams = {
      privateKey: opts.privateKey,
      getPublicClient: ({ chain }: { chain: Chain }) =>
        createPublicClient({ chain, transport: http(config.rpcHttp) }),
      getWalletClient: ({ chain }: { chain: Chain }) =>
        createWalletClient({ account, chain, transport: http(config.rpcHttp) }),
    } as unknown as Parameters<typeof createViemAdapterFromPrivateKey>[0];
    const adapter = createViemAdapterFromPrivateKey(adapterParams);
    const context = createSwapKitContext();
    const raw = await estimate(context, {
      from: { adapter: adapter as never, chain: SwapChain.Arc_Testnet },
      tokenIn: opts.tokenIn as never,
      tokenOut: opts.tokenOut as never,
      amountIn: opts.amountIn,
      config: { kitKey: config.scout.kitKey! } as never,
    } as never);
    return { ok: true, raw };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
