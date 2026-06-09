"use client";

import { useCallback } from "react";
import { useWriteContract } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { useCircleExecute, type CircleWriteArgs } from "@/hooks/useCircleExecute";
import { useEnsureArc } from "@/hooks/useEnsureArc";

/// Unified write surface for ArcRun call sites. Resolves at runtime to either
/// wagmi's useWriteContract (for users with an injected wallet) or
/// useCircleExecute (for email-login users whose writes the backend signs
/// through Circle Developer-Controlled wallets). Call sites use this one hook
/// and don't have to branch.
///
/// The returned `writeContractAsync` matches wagmi's shape so callers can
/// keep calling `await publicClient.waitForTransactionReceipt({ hash })` on
/// the result.

export function useArcWrite() {
  const { me } = useAuth();
  const wagmi = useWriteContract();
  const circle = useCircleExecute();
  const ensureOnArc = useEnsureArc();
  const isCircle = me?.walletKind === "circle";

  const writeContractAsync = useCallback(
    async (args: CircleWriteArgs): Promise<`0x${string}`> => {
      if (isCircle) {
        // Circle Dev-Controlled wallets are backend-signed on Arc directly,
        // so no chain switch is needed for the email-login path.
        return circle.writeContractAsync(args);
      }
      // For wagmi (injected wallet) writes: if the user is coming back from
      // /bridge with the wallet still on Sepolia or Polygon, swap to Arc
      // before signing. Throws a friendly error if the user declines.
      await ensureOnArc();
      // wagmi's writeContractAsync types are heavily inferred from the ABI; the
      // unified hook accepts a looser shape so the dual-path call sites don't
      // have to know what kind of wallet the user has. The `unknown` cast lets
      // wagmi infer args at the actual call site.
      return wagmi.writeContractAsync({
        address: args.address,
        abi: args.abi,
        functionName: args.functionName,
        args: args.args as unknown as never,
        ...(args.value ? { value: BigInt(args.value) } : {}),
      } as Parameters<typeof wagmi.writeContractAsync>[0]);
    },
    [isCircle, circle, wagmi, ensureOnArc],
  );

  return {
    writeContractAsync,
    isPending: isCircle ? circle.isPending : wagmi.isPending,
  };
}
