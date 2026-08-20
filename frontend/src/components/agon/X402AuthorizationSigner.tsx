"use client";

import { useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSignTypedData, useSwitchChain } from "wagmi";

import { submitX402AuthorizationSignature } from "@/lib/agon/client";
import { getX402SigningGate } from "@/lib/agon/authorization-signing";
import { arcTestnet } from "@/lib/arc";
import type { X402AuthorizationSubmittedView, X402AuthorizationView } from "@/lib/agon/types";
import { TagButton } from "@/components/redesign/TagButton";

type Props = {
  intentId: string;
  authorization: X402AuthorizationView;
  preview?: boolean;
  onSubmitted: (value: X402AuthorizationSubmittedView) => void;
};

export function X402AuthorizationSigner({ intentId, authorization, preview = false, onSubmitted }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const { signTypedDataAsync } = useSignTypedData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = getX402SigningGate(authorization, { preview, address, isConnected, chainId });

  async function sign() {
    if (!address || gate !== "ready") return;
    setBusy(true);
    setError(null);
    try {
      const signature = await signTypedDataAsync({
        account: address,
        domain: authorization.payload.domain,
        types: authorization.payload.types,
        primaryType: authorization.payload.primaryType,
        message: {
          ...authorization.payload.message,
          value: BigInt(authorization.payload.message.value),
          validAfter: BigInt(authorization.payload.message.validAfter),
          validBefore: BigInt(authorization.payload.message.validBefore),
        },
      } as never);
      const submitted = await submitX402AuthorizationSignature(intentId, {
        payloadHash: authorization.payloadHash,
        signature,
      });
      onSubmitted(submitted);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The wallet did not sign this authorization.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-current pt-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em]">WALLET SIGNATURE</div>
      <p className="mt-2 font-mono text-[10px] leading-relaxed opacity-75">Agon will submit the signature hash for validation only. It will not send payment or call the provider.</p>

      {preview ? <p className="mt-3 border-l-2 border-[color:var(--warn)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--warn)]">PREVIEW MODE · wallet signing is disabled and no signature is simulated.</p> : null}
      {gate === "connect_wallet" ? <TagButton variant="primary" size="sm" className="mt-3" onClick={() => openConnectModal?.()} disabled={!openConnectModal}>CONNECT WALLET TO SIGN →</TagButton> : null}
      {gate === "switch_chain" ? <TagButton variant="primary" size="sm" className="mt-3" onClick={() => switchChain({ chainId: arcTestnet.id })} disabled={switching}>{switching ? "SWITCHING..." : "SWITCH TO ARC TESTNET →"}</TagButton> : null}
      {gate === "wrong_account" ? <p className="mt-3 border-l-2 border-[color:var(--err)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--err)]">Connected wallet does not match the authorization owner. Switch accounts before signing.</p> : null}
      {gate === "ready" ? <TagButton variant="primary" size="sm" className="mt-3" onClick={sign} disabled={busy}>{busy ? "VALIDATING SIGNATURE..." : "SIGN EXACT AUTHORIZATION →"}</TagButton> : null}
      {error ? <p role="alert" className="mt-3 border-l-2 border-[color:var(--err)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--err)]">{error}</p> : null}
    </div>
  );
}
