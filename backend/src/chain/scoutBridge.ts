import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createWalletClient, http } from "viem";
import type { Account, Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet } from "./arc.js";
import { config } from "../config/index.js";

/// One-way CCTP bridge for a Scout hot wallet. A Scout op is occasionally a real
/// Arc -> Base USDC bridge instead of a swap: it moves money cross-chain, which
/// counts toward the same volume score, and surfaces as a BRIDGE row on the
/// economy tape. Same caps, traits, and training govern how often and how big it
/// runs (the caller's per-round cap and per-swap size already apply).
///
/// Why a private-key adapter and not circleBridge.ts: the Scout hot wallets are
/// plain EOAs derived from the master mnemonic, not Circle custodial wallets, so
/// they sign through App Kit's viem private-key adapter (the same family the swap
/// path uses), not the Circle Wallets adapter.
///
/// Why one-way Arc -> Base, not a round-trip: the return leg would burn on Base,
/// which needs native ETH gas the hot wallet does not hold. The Arc -> Base burn
/// is paid in USDC gas on Arc, which the wallet does have. The forwarder mints on
/// Base, so the wallet needs nothing on the destination chain. The Arc wallet is
/// kept funded by the autofunder, so the small outbound per op does not stall it.

export interface ScoutBridgeResult {
  txHash: `0x${string}`;
  amount6: bigint;
  destChain: string;
}

/// Bridge `amountUsdc` of USDC from the hot wallet on Arc to its own address on
/// the destination chain. Returns the burn tx (the on-chain proof the USDC left
/// Arc) plus the amount moved, or null if anything failed or timed out. Never
/// throws: a failed bridge is just a missed op in the race.
export async function bridgeScoutLeg(
  privateKey: `0x${string}`,
  amountUsdc: number,
  opts?: { sourceChain?: string; destChain?: string; timeoutMs?: number },
): Promise<ScoutBridgeResult | null> {
  if (!(amountUsdc > 0)) return null;
  const sourceChain = opts?.sourceChain ?? process.env.SCOUT_BRIDGE_SOURCE_CHAIN ?? "Arc_Testnet";
  const destChain = opts?.destChain ?? process.env.SCOUT_BRIDGE_DEST_CHAIN ?? "Base_Sepolia";
  const timeoutMs = opts?.timeoutMs ?? Number(process.env.SCOUT_BRIDGE_TIMEOUT_MS ?? "90000");

  try {
    const account = privateKeyToAccount(privateKey);
    const adapter = createViemAdapterFromPrivateKey({
      privateKey,
      // Pin the Arc source leg to our known-good RPC so the burn signs against
      // the same endpoint as the swaps; other chains fall back to viem defaults.
      getWalletClient: ({ chain, account: signer }: { chain: Chain; account: Account }) =>
        createWalletClient({
          account: signer,
          chain,
          transport: chain.id === arcTestnet.id ? http(config.rpcHttp) : http(),
        }),
    } as never);

    const kit = new AppKit();
    const bridgePromise = kit.bridge({
      from: { adapter, chain: sourceChain } as never,
      to: {
        recipientAddress: account.address,
        chain: destChain as never,
        useForwarder: true,
      },
      amount: amountUsdc.toFixed(6),
    });

    const result = await Promise.race([
      bridgePromise,
      new Promise<"timeout">((res) => setTimeout(() => res("timeout"), timeoutMs)),
    ]);
    const txHash = extractBurnTx(result);
    if (!txHash) return null;
    return { txHash, amount6: BigInt(Math.round(amountUsdc * 1e6)), destChain };
  } catch {
    return null;
  }
}

/// Pull the burn step's tx hash from an App Kit bridge result (same step shape
/// circleBridge returns). Prefer the burn step (USDC leaving Arc); fall back to
/// the first landed step with a hash.
function extractBurnTx(result: unknown): `0x${string}` | null {
  if (!result || typeof result !== "object") return null;
  const steps = (result as { steps?: Array<{ name?: string; txHash?: string }> }).steps ?? [];
  const burn = steps.find((s) => /burn/i.test(String(s.name ?? "")) && s.txHash);
  if (burn?.txHash) return burn.txHash as `0x${string}`;
  const any = steps.find((s) => s.txHash);
  return (any?.txHash as `0x${string}`) ?? null;
}
