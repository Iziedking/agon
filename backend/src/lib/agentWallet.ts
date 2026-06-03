import type { Account, Hash } from "viem";
import { createWalletClient, http } from "viem";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";
import { deriveHotWallet, hotWalletBalance } from "../runners/scout.js";
import { usdcMinimalAbi } from "../chain/abi.js";

/// Unified hot-wallet interface for agent on-chain actions outside Scout's
/// own loop. Today this just wraps the Scout-derived mnemonic wallet so the
/// Analyst runner has a place to send Arcana trades from. Tomorrow it'll
/// add a Circle Dev-Controlled path for Circle-email operators by checking
/// whether the agent's owning operator has a Circle wallet attached.
///
/// One function, one shape, so the analyst runner doesn't grow a fork per
/// wallet kind. Add new kinds here.

export type AgentWalletKind = "derived";

export interface AgentWalletHandle {
  kind: AgentWalletKind;
  address: `0x${string}`;
  /// Send a single contract write. Mirrors viem's writeContract args minus
  /// chain (already set) and account (already attached). Waits for receipt
  /// and returns the tx hash. Throws on revert or timeout.
  writeContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<Hash>;
}

/// Returns the wallet handle for an agent. Today: always derived from the
/// Scout master mnemonic by agentId. If the mnemonic is unset, returns null
/// (caller decides whether to skip the agent or fall back).
export function getAgentWallet(agentId: number): AgentWalletHandle | null {
  if (!config.scout.masterMnemonic) return null;
  const account: Account = deriveHotWallet(agentId);
  const wallet = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(config.rpcHttp),
  });
  return {
    kind: "derived",
    address: account.address,
    async writeContract(args) {
      const hash = await wallet.writeContract({
        ...(args as Parameters<typeof wallet.writeContract>[0]),
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

/// Convenience pass-through so callers don't need to import scout.ts. The
/// balance is in USDC 6-decimals.
export async function getAgentUsdcBalance(agentId: number): Promise<bigint> {
  if (!config.scout.masterMnemonic) return 0n;
  return hotWalletBalance(agentId);
}

/// Returns the agent's USDC allowance to a given spender. Used by the
/// Analyst runner to decide whether to send an approve() before buyShares().
export async function getAgentUsdcAllowance(
  agentId: number,
  spender: `0x${string}`,
): Promise<bigint> {
  if (!config.scout.masterMnemonic) return 0n;
  const account = deriveHotWallet(agentId);
  return publicClient.readContract({
    address: config.external.USDC,
    abi: usdcMinimalAbi,
    functionName: "allowance",
    args: [account.address, spender],
  }) as Promise<bigint>;
}
