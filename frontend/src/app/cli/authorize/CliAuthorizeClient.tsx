"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, CornerMarkers, SectionHeader, StatusChip } from "@/components/redesign";
import { LoginButton } from "@/components/pengu/LoginButton";
import { approveCliDevice, fetchCliDeviceInfo, type CliDeviceInfo } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";

export function CliAuthorizeClient() {
  const params = useSearchParams();
  const userCode = (params.get("user_code") ?? "").trim().toUpperCase();
  const { me, settling } = useAuth();
  const [device, setDevice] = useState<CliDeviceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (!userCode) {
      setError("This approval link has no device code.");
      return;
    }
    let cancelled = false;
    void fetchCliDeviceInfo(userCode)
      .then((next) => {
        if (!cancelled) {
          setDevice(next);
          setApproved(next.status === "approved");
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "device request not found");
      });
    return () => {
      cancelled = true;
    };
  }, [userCode]);

  async function approve() {
    setWorking(true);
    setError(null);
    try {
      await approveCliDevice(userCode);
      setApproved(true);
      setDevice((current) => current ? { ...current, status: "approved" } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not approve CLI access");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="mx-auto max-w-[980px] px-4 pb-20 pt-16 sm:px-6">
        <CornerMarkers />
        <SectionHeader
          size="hero"
          eyebrow="AGON CLI / DEVICE AUTHORIZATION"
          heading="AUTHORIZE THIS TERMINAL"
          subDeck="Approve a short-lived Agon API session for the terminal you started. This does not share a private key and does not sign a blockchain transaction."
        />

        <div className="mt-10 grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
          <BracketedCell pad="lg">
            {error ? <p className="font-mono text-sm text-[color:var(--err)]">{error}</p> : null}
            {!error && !device ? <p className="font-mono text-sm text-ink-2">CHECKING DEVICE REQUEST...</p> : null}
            {device ? (
              <>
                <StatusChip tone={approved ? "ok" : device.status === "expired" ? "warn" : "accent"}>
                  {approved ? "APPROVED" : device.status.toUpperCase()}
                </StatusChip>
                <div className="mt-7 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">CLIENT</div>
                <div className="mt-2 font-stencil text-4xl uppercase">{device.clientName}</div>
                <div className="mt-6 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">DEVICE CODE</div>
                <div className="mt-2 font-mono text-2xl tracking-[0.16em] text-accent">{userCode || "—"}</div>
                <div className="mt-6 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">REQUESTED CAPABILITIES</div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2 font-mono text-[11px] text-ink-2">
                  {device.scopes.map((scope) => <span key={scope}>{scope}</span>)}
                </div>
                <p className="mt-6 max-w-[60ch] font-mono text-[12px] leading-relaxed text-ink-2">
                  The terminal will receive an Agon bearer session bound to your signed-in account. It expires with the
                  normal session lifetime and can be revoked by ending the CLI session.
                </p>
                {device.status === "expired" ? (
                  <p className="mt-6 font-mono text-[12px] text-[color:var(--warn)]">This request expired. Start a new login from the terminal.</p>
                ) : approved ? (
                  <p className="mt-6 font-mono text-[12px] text-ink-2">Return to the terminal. It can continue now.</p>
                ) : me ? (
                  <button
                    type="button"
                    disabled={working || settling}
                    onClick={() => void approve()}
                    className="mt-7 bg-accent px-5 py-3 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press disabled:cursor-wait disabled:opacity-60"
                  >
                    {working ? "APPROVING..." : "APPROVE CLI SESSION →"}
                  </button>
                ) : (
                  <div className="mt-7 flex flex-wrap items-center gap-4">
                    <LoginButton />
                    <span className="font-mono text-[11px] text-ink-3">Sign in, then approve this terminal.</span>
                  </div>
                )}
              </>
            ) : null}
          </BracketedCell>

          <BracketedCell pad="md">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">SECURITY BOUNDARY</div>
            <ul className="mt-5 space-y-4 font-mono text-[11px] leading-relaxed text-ink-2">
              <li>✓ The device code is single-use.</li>
              <li>✓ The browser session chooses the account.</li>
              <li>✓ The CLI receives no wallet key.</li>
              <li>✓ Transaction signing remains a separate reviewed step.</li>
            </ul>
          </BracketedCell>
        </div>
      </main>
      <Footer variant="agon" />
    </div>
  );
}
