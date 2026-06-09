"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { erc20Abi, formatUnits, parseUnits } from "viem";

import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import {
  BracketedCell,
  CornerMarkers,
  SectionHeader,
  StatusChip,
  TagButton,
} from "@/components/redesign";
import {
  ARC_OUTBOUND_MIN_USDC,
  BRIDGE_CHAINS,
  BRIDGE_STEPS,
  bridgeChainById,
  type BridgeChain,
  type BridgeStepProgress,
} from "@/lib/bridge";

/// One-click USDC bridge. Powered by Circle Bridge Kit (`@circle-fin/app-kit`)
/// with the wagmi-bound Viem adapter. Forwarding Service is on by default
/// so the user doesn't need a wallet on the destination chain — Circle's
/// infrastructure handles the mint.
///
/// Layout: source picker, amount input, destination picker (defaults to
/// Arc Testnet, the platform's home chain), ESTIMATE then BRIDGE. The
/// four CCTP steps (approve → burn → attest → mint) light up live with
/// per-step tx hashes the user can click into the explorer.

const ARC_ID = BRIDGE_CHAINS.find((c) => c.code === "ARC")!.id;
const DEFAULT_SOURCE = BRIDGE_CHAINS.find((c) => c.code === "BASE")!;
const DEFAULT_DEST = BRIDGE_CHAINS.find((c) => c.code === "ARC")!;

export default function BridgePage() {
  const { address: account, isConnected, chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [sourceId, setSourceId] = useState<number>(DEFAULT_SOURCE.id);
  const [destId, setDestId] = useState<number>(DEFAULT_DEST.id);
  const [amount, setAmount] = useState<string>("1.00");
  const [steps, setSteps] = useState<BridgeStepProgress[]>(initialSteps());
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completedTxHash, setCompletedTxHash] = useState<string | null>(null);

  const source = bridgeChainById(sourceId)!;
  const dest = bridgeChainById(destId)!;
  const isOutboundFromArc = sourceId === ARC_ID;

  const { data: balanceWei } = useReadContract({
    abi: erc20Abi,
    address: source.usdcAddress,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId: source.id as never,
    query: { enabled: Boolean(account), refetchInterval: 12_000 },
  });
  const balance = useMemo(() => {
    if (typeof balanceWei !== "bigint") return null;
    return Number(formatUnits(balanceWei, 6));
  }, [balanceWei]);

  // Block bridge when source == dest, amount invalid, or the outbound-from-Arc
  // minimum isn't met (CCTPv2 max fee floor).
  const amountNum = Number(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const meetsArcOutboundMin = !isOutboundFromArc || amountNum >= ARC_OUTBOUND_MIN_USDC;
  const sameChain = sourceId === destId;
  const insufficientBalance =
    balance !== null && validAmount && amountNum > balance;
  const blocker =
    sameChain
      ? "Pick different source and destination."
      : !validAmount
        ? "Enter an amount greater than 0."
        : !meetsArcOutboundMin
          ? `Out-of-Arc bridges must exceed ~${ARC_OUTBOUND_MIN_USDC} USDC (CCTPv2 max fee).`
          : insufficientBalance
            ? "Source wallet doesn't have enough USDC."
            : !account
              ? "Connect a wallet to bridge."
              : null;

  async function onBridge() {
    if (blocker) return;
    setErrorMsg(null);
    setCompletedTxHash(null);
    setSteps(initialSteps());
    setRunning(true);

    try {
      // The wallet has to be on the source chain to sign the burn. wagmi
      // throws if the user rejects the switch — we surface that as the error.
      if (walletChainId !== source.id) {
        try {
          await switchChainAsync({ chainId: source.id as never });
        } catch (err) {
          throw new Error("You rejected the network switch.");
        }
      }

      const { AppKit } = await import("@circle-fin/app-kit");
      const { createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2");

      const provider = typeof window !== "undefined" ? (window as { ethereum?: unknown }).ethereum : undefined;
      if (!provider) throw new Error("No injected wallet found.");
      const adapter = await createViemAdapterFromProvider({
        provider: provider as never,
      });

      const kit = new AppKit();
      // Subscribe to per-step events so the UI lights up in real time.
      const stepHandler = (name: BridgeStepProgress["name"]) => (payload: unknown) => {
        const p = payload as { values?: { state?: BridgeStepProgress["state"]; txHash?: string; explorerUrl?: string; error?: string } };
        updateStep(setSteps, name, {
          state: p.values?.state ?? "pending",
          txHash: p.values?.txHash,
          explorerUrl: p.values?.explorerUrl,
          error: p.values?.error,
        });
      };
      kit.on("bridge.approve", stepHandler("approve"));
      kit.on("bridge.burn", stepHandler("burn"));
      kit.on("bridge.fetchAttestation", stepHandler("fetchAttestation"));
      kit.on("bridge.mint", stepHandler("mint"));

      const result = await kit.bridge({
        from: { adapter, chain: source.appKitChain as never },
        to: {
          adapter,
          chain: dest.appKitChain as never,
          useForwarder: true,
        },
        amount,
      });

      if ((result as { state?: string }).state === "error") {
        throw new Error("Bridge transfer failed mid-flight. See step errors above.");
      }
      // Capture the last successful tx hash so the success card can link to it.
      const lastSuccess = ((result as { steps?: Array<{ state: string; txHash?: string }> }).steps ?? [])
        .filter((s) => s.state === "success" && s.txHash)
        .at(-1);
      setCompletedTxHash(lastSuccess?.txHash ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1200px] px-6 pt-16">
        <CornerMarkers />
        <SectionHeader
          eyebrow={
            <span className="flex flex-wrap items-center gap-3">
              <span aria-hidden className="text-accent">■</span> BRIDGE
              <StatusChip tone="ok">CCTP V2</StatusChip>
              <span className="text-ink-3">· 8 chains · forwarder on</span>
            </span>
          }
          heading="BRIDGE USDC"
          subDeck={
            <>
              move usdc between testnets via circle bridge kit. forwarder
              service settles the destination side, no destination wallet
              needed.
            </>
          }
        />
      </section>

      <section className="mx-auto max-w-[1200px] px-6 py-10">
        <BracketedCell pad="lg" className="flex flex-col gap-6">
          <ChainPicker label="FROM" value={sourceId} onChange={setSourceId} balance={balance} />

          <AmountInput
            value={amount}
            onChange={setAmount}
            sourceCode={source.code}
            onMax={balance !== null ? () => setAmount(String(balance)) : undefined}
          />

          <ChainPicker label="TO" value={destId} onChange={setDestId} excludeId={sourceId} />

          {isOutboundFromArc ? (
            <div className="border-l-2 border-accent bg-canvas-2 px-4 py-3 font-mono text-[11px] text-ink-2">
              <span className="text-accent">NOTE</span> · outbound-from-Arc
              bridges must exceed ~{ARC_OUTBOUND_MIN_USDC} USDC (CCTPv2 max fee).
            </div>
          ) : null}

          {blocker ? (
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              {blocker}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <TagButton onClick={onBridge} disabled={Boolean(blocker) || running || !isConnected}>
              {running ? "BRIDGING…" : "BRIDGE NOW"}
            </TagButton>
            <span className="font-mono text-[11px] text-ink-3">
              ~8 to 20s on fast routes. fee shown on each step.
            </span>
          </div>
        </BracketedCell>

        <StepStrip steps={steps} running={running} />

        {errorMsg ? (
          <div className="mt-6 border border-[color:var(--hairline-strong)] bg-canvas-2 p-4 font-mono text-[12px] text-ink-2">
            <span className="text-accent">ERROR</span> · {errorMsg}
          </div>
        ) : null}

        {completedTxHash ? (
          <BracketedCell pad="md" className="mt-6">
            <div className="flex flex-wrap items-center gap-3 font-mono text-[12px]">
              <span className="text-accent">■</span>
              <span className="text-ink">BRIDGE COMPLETE</span>
              <span className="text-ink-3">·</span>
              <a
                href={`${dest.explorer}/tx/${completedTxHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-ink-2 hover:text-accent"
              >
                view destination tx ↗
              </a>
            </div>
          </BracketedCell>
        ) : null}
      </section>

      <Footer />
    </div>
  );
}

function initialSteps(): BridgeStepProgress[] {
  return BRIDGE_STEPS.map((s) => ({ name: s.name, state: "idle" as const }));
}

function updateStep(
  set: (fn: (prev: BridgeStepProgress[]) => BridgeStepProgress[]) => void,
  name: BridgeStepProgress["name"],
  patch: Partial<BridgeStepProgress>,
) {
  set((prev) => prev.map((s) => (s.name === name ? { ...s, ...patch } : s)));
}

function ChainPicker({
  label,
  value,
  onChange,
  balance,
  excludeId,
}: {
  label: string;
  value: number;
  onChange: (id: number) => void;
  balance?: number | null;
  excludeId?: number;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
        <span>{label}</span>
        {balance !== undefined && balance !== null ? (
          <span className="text-ink-2">balance: {balance.toFixed(4)} USDC</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {BRIDGE_CHAINS.map((c) => {
          const isSelected = c.id === value;
          const isExcluded = excludeId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              disabled={isExcluded}
              onClick={() => onChange(c.id)}
              className={[
                "relative border px-3 py-3 text-left font-mono transition-colors",
                isSelected
                  ? "border-accent bg-canvas-2 text-ink"
                  : isExcluded
                    ? "border-[color:var(--hairline)] bg-canvas text-ink-3 opacity-40"
                    : "border-[color:var(--hairline)] bg-canvas text-ink hover:bg-canvas-2",
              ].join(" ")}
            >
              <div className="text-[11px] uppercase tracking-[0.12em]">{c.code}</div>
              <div className="text-[10px] text-ink-3">{c.label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AmountInput({
  value,
  onChange,
  sourceCode,
  onMax,
}: {
  value: string;
  onChange: (v: string) => void;
  sourceCode: string;
  onMax?: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
        <span>AMOUNT</span>
        {onMax ? (
          <button
            type="button"
            onClick={onMax}
            className="text-accent hover:text-ink"
          >
            MAX
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-3 border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 py-3">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(sanitizeAmount(e.target.value))}
          className="w-full bg-transparent font-stencil text-[40px] text-ink outline-none"
          aria-label="Amount to bridge"
        />
        <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-3">
          USDC / {sourceCode}
        </span>
      </div>
    </div>
  );
}

function sanitizeAmount(v: string): string {
  // Keep digits + one decimal point, drop everything else.
  const trimmed = v.replace(/[^0-9.]/g, "");
  const parts = trimmed.split(".");
  if (parts.length <= 1) return trimmed;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function StepStrip({
  steps,
  running,
}: {
  steps: BridgeStepProgress[];
  running: boolean;
}) {
  // Hide entirely until the user starts a bridge, or one step has progressed.
  const anyActive = running || steps.some((s) => s.state !== "idle");
  if (!anyActive) return null;
  return (
    <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-4">
      {steps.map((s) => {
        const label = BRIDGE_STEPS.find((x) => x.name === s.name)?.label ?? s.name;
        const tone =
          s.state === "success"
            ? "border-accent bg-canvas-2 text-ink"
            : s.state === "error"
              ? "border-[color:var(--err)] text-ink"
              : s.state === "pending"
                ? "border-[color:var(--warn)] text-ink-2"
                : "border-[color:var(--hairline)] text-ink-3";
        return (
          <div key={s.name} className={`border ${tone} flex flex-col gap-1 px-3 py-3 font-mono`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.12em]">{label}</span>
              <span className="text-[10px] uppercase tracking-[0.12em] text-ink-3">
                {s.state}
              </span>
            </div>
            {s.txHash && s.explorerUrl ? (
              <a
                href={s.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate text-[10px] text-ink-2 hover:text-accent"
              >
                {s.txHash.slice(0, 10)}…{s.txHash.slice(-6)} ↗
              </a>
            ) : null}
            {s.error ? (
              <span className="text-[10px] text-[color:var(--err)]">{s.error}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// Silence unused-import lint when only parseUnits is referenced through types.
void parseUnits;
