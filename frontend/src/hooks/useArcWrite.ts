"use client";

import { useCallback } from "react";
import { useAccount, useReconnect, useWriteContract } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAuth } from "@/hooks/useAuth";
import { useCircleExecute, type CircleWriteArgs } from "@/hooks/useCircleExecute";
import { useCircleUserControlledExecute } from "@/hooks/useCircleUserControlledExecute";
import { activeCircleUserControlledAddress } from "@/lib/circle-user-controlled";
import { useEnsureArc } from "@/hooks/useEnsureArc";
import { arcTestnet } from "@/lib/arc";

/// Thrown when a wagmi user's wallet is disconnected at write time and we've
/// opened the picker for them to reconnect. The session is still valid, so the
/// caller should surface "reconnect and retry", not "sign in".
export class WalletReconnectError extends Error {
  constructor() {
    super("your wallet got disconnected. reconnect it, then try again.");
    this.name = "WalletReconnectError";
  }
}

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
  const circleUserControlled = useCircleUserControlledExecute();
  const ensureOnArc = useEnsureArc();
  const { isConnected } = useAccount();
  const { reconnectAsync } = useReconnect();
  const { openConnectModal } = useConnectModal();
  const isCircle = me?.walletKind === "circle";
  const activeUserControlledAddress = activeCircleUserControlledAddress();
  const isCircleUserControlled = Boolean(
    activeUserControlledAddress &&
      me?.walletPrincipals?.some(
        (principal) => principal.mode === "circle_user_controlled" && principal.address.toLowerCase() === activeUserControlledAddress,
      ),
  );

  const writeContractAsync = useCallback(
    async (args: CircleWriteArgs): Promise<`0x${string}`> => {
      if (isCircleUserControlled) return circleUserControlled.writeContractAsync(args);
      if (isCircle) {
        // Circle Dev-Controlled wallets are backend-signed on Arc directly,
        // so no chain switch is needed for the email-login path.
        return circle.writeContractAsync(args);
      }
      // The session can be valid (signed in) while the injected wallet has
      // dropped its connection — common after a cold page load, since the
      // wallet reconnects asynchronously and may not be back by the time the
      // user clicks. Rather than fail the write (and make them sign out / in),
      // reconnect in place: a silent reconnect from stored state first, and if
      // that restores nothing, open the picker so they reconnect WITHOUT a
      // fresh SIWE, then retry the action. The cookie session stays intact.
      if (!isConnected) {
        let restored = false;
        try {
          const connectors = await reconnectAsync();
          restored = Array.isArray(connectors) && connectors.length > 0;
        } catch {
          restored = false;
        }
        if (!restored) {
          openConnectModal?.();
          throw new WalletReconnectError();
        }
      }
      // For wagmi (injected wallet) writes: if the user is coming back from
      // /bridge with the wallet still on Sepolia or Polygon, swap to Arc
      // before signing. Throws a friendly error if the user declines.
      await ensureOnArc();
      // Pin the write to Arc. With `chainId` set, wagmi/viem verifies the
      // wallet is on Arc at send time and throws ChainMismatchError otherwise,
      // so a tx can never fire on the wrong chain even if the switch above
      // didn't fully propagate (e.g. wallet still on ETH mainnet).
      //
      // wagmi's writeContractAsync types are heavily inferred from the ABI; the
      // unified hook accepts a looser shape so the dual-path call sites don't
      // have to know what kind of wallet the user has. The `unknown` cast lets
      // wagmi infer args at the actual call site.
      return wagmi.writeContractAsync({
        address: args.address,
        abi: args.abi,
        functionName: args.functionName,
        args: args.args as unknown as never,
        chainId: arcTestnet.id,
        ...(args.value ? { value: BigInt(args.value) } : {}),
      } as Parameters<typeof wagmi.writeContractAsync>[0]);
    },
    [isCircle, isCircleUserControlled, circle, circleUserControlled, wagmi, ensureOnArc, isConnected, reconnectAsync, openConnectModal],
  );

  return {
    writeContractAsync,
    isPending: isCircle ? circle.isPending : isCircleUserControlled ? circleUserControlled.isPending : wagmi.isPending,
  };
}
