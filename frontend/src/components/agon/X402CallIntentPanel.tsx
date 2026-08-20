"use client";

import { useEffect, useMemo, useState } from "react";

import { LoginModal } from "@/components/pengu/LoginModal";
import { TagButton } from "@/components/redesign/TagButton";
import { useAuth } from "@/hooks/useAuth";
import { AGON_PREVIEW_MODE, prepareX402CallIntent } from "@/lib/agon/client";
import { assessX402Readiness, buildCallIntentRequest, newCallIntentKey } from "@/lib/agon/call-intent";
import type { AgonListing, X402CallIntentView } from "@/lib/agon/types";

type Props = {
  listing: AgonListing;
  defaultAmount: string | null;
};

export function X402CallIntentPanel({ listing, defaultAmount }: Props) {
  const { me } = useAuth();
  const readiness = useMemo(() => assessX402Readiness(listing), [listing]);
  const [loginOpen, setLoginOpen] = useState(false);
  const [method, setMethod] = useState<"GET" | "POST">("POST");
  const [input, setInput] = useState("{\n  \n}");
  const [maxAmountUSDC, setMaxAmountUSDC] = useState(defaultAmount ?? "0.01");
  const [intent, setIntent] = useState<X402CallIntentView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (me && loginOpen) setLoginOpen(false);
  }, [loginOpen, me]);

  async function prepare() {
    setMessage(null);
    setIntent(null);
    if (!me) {
      setLoginOpen(true);
      return;
    }
    if (AGON_PREVIEW_MODE) {
      setMessage("Inspection preview only. No authenticated call is sent from this deployment.");
      return;
    }
    const key = idempotencyKey || newCallIntentKey();
    setIdempotencyKey(key);
    const request = buildCallIntentRequest(key, method, input, maxAmountUSDC);
    if ("error" in request) {
      setMessage(request.error);
      return;
    }
    setPreparing(true);
    try {
      setIntent(await prepareX402CallIntent(listing.id, request));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agon could not prepare this call.");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div className="mt-7 border-t border-current pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em]">CALL PREPARATION</div>
          <p className="mt-2 max-w-[42ch] font-mono text-[10px] leading-relaxed opacity-70">
            Review the exact input and maximum spend. Preparation never pays or calls the provider.
          </p>
        </div>
        <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${readiness.eligible ? "text-[color:var(--ok)]" : "text-[color:var(--err)]"}`}>
          {readiness.label}
        </span>
      </div>

      {!readiness.eligible ? (
        <p className="mt-4 border-l-2 border-[color:var(--err)] pl-3 font-mono text-[10px] leading-relaxed opacity-75">{readiness.reason}</p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)]">
            <label className="font-mono text-[9px] uppercase tracking-[0.12em] opacity-65">
              METHOD
              <select value={method} onChange={(event) => setMethod(event.target.value as "GET" | "POST")} className="mt-2 h-10 w-full border border-current bg-transparent px-2 font-mono text-[11px] opacity-100">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </label>
            <label className="font-mono text-[9px] uppercase tracking-[0.12em] opacity-65">
              MAX SPEND · USDC
              <input value={maxAmountUSDC} onChange={(event) => setMaxAmountUSDC(event.target.value)} inputMode="decimal" className="mt-2 h-10 w-full border border-current bg-transparent px-3 font-mono text-[11px] text-current" />
            </label>
          </div>
          <label className="mt-4 block font-mono text-[9px] uppercase tracking-[0.12em] opacity-65">
            JSON INPUT
            <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={4} spellCheck={false} className="mt-2 w-full resize-y border border-current bg-transparent p-3 font-mono text-[11px] leading-relaxed text-current" />
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {me ? (
              <TagButton variant="primary" size="sm" onClick={prepare} disabled={preparing}>{preparing ? "PREPARING..." : "REVIEW CALL →"}</TagButton>
            ) : (
              <TagButton variant="primary" size="sm" onClick={() => setLoginOpen(true)}>SIGN IN TO CONTINUE →</TagButton>
            )}
            {idempotencyKey ? <span className="font-mono text-[9px] uppercase tracking-[0.08em] opacity-50">RETRY-SAFE KEY READY</span> : null}
          </div>
        </>
      )}

      {message ? <p role="alert" className="mt-4 border-l-2 border-[color:var(--warn)] pl-3 font-mono text-[10px] leading-relaxed">{message}</p> : null}
      {intent ? (
        <div className="mt-5 border border-[color:var(--ok)] p-4 font-mono text-[10px] leading-relaxed">
          <div className="flex items-center justify-between gap-3 uppercase tracking-[0.12em] text-[color:var(--ok)]"><span>INTENT PREPARED</span><span>EXECUTION OFF</span></div>
          <div className="mt-3 space-y-1 opacity-75"><div>INPUT HASH · {intent.inputHash}</div><div>MAX SPEND · {intent.maxAmountUSDC} USDC</div><div>NEXT · {intent.nextAction.replaceAll("_", " ")}</div></div>
        </div>
      ) : null}

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
