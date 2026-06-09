"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContract, useSwitchChain, useWalletClient } from "wagmi";
import { erc20Abi, formatUnits, isAddress, parseUnits } from "viem";

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

/// One-click USDC mover. Defaults source AND destination to Arc Testnet —
/// when both are Arc the page renders the same-chain TRANSFER flow (direct
/// USDC.transfer via viem). When they differ, it's a CCTP bridge via Circle
/// App Kit with the Forwarding Service on so the user never needs a wallet
/// on the destination chain.

const ARC_ID = BRIDGE_CHAINS.find((c) => c.code === "ARC")!.id;
const DEFAULT_SOURCE = BRIDGE_CHAINS.find((c) => c.code === "ARC")!;
const DEFAULT_DEST = BRIDGE_CHAINS.find((c) => c.code === "ARC")!;

export default function BridgePage() {
  const { address: account, isConnected, chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const [sourceId, setSourceId] = useState<number>(DEFAULT_SOURCE.id);
  const [destId, setDestId] = useState<number>(DEFAULT_DEST.id);
  const [amount, setAmount] = useState<string>("1.00");
  const [recipient, setRecipient] = useState<string>("");
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

  const amountNum = Number(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const meetsArcOutboundMin = !isOutboundFromArc || amountNum >= ARC_OUTBOUND_MIN_USDC;
  const sameChain = sourceId === destId;
  const insufficientBalance =
    balance !== null && validAmount && amountNum > balance;
  // Same-chain selection means transfer mode; cross-chain means CCTP bridge.
  const mode: "bridge" | "transfer" = sameChain ? "transfer" : "bridge";
  const validRecipient =
    mode === "transfer"
      ? recipient.trim().length > 0 && isAddress(recipient.trim())
      : true;
  const onWrongChain = isConnected && walletChainId !== source.id;

  // Order matters: when the wallet is on the wrong chain we surface the
  // network switch CTA instead of a blocker so the button can act on it.
  const blocker =
    !validAmount
      ? "Enter an amount greater than 0."
      : mode === "bridge" && !meetsArcOutboundMin
        ? `Out-of-Arc bridges must exceed ~${ARC_OUTBOUND_MIN_USDC} USDC (CCTPv2 max fee).`
        : insufficientBalance
          ? "Source wallet doesn't have enough USDC."
          : !account
            ? "Connect a wallet first."
            : mode === "transfer" && !validRecipient
              ? "Enter a recipient address."
              : null;

  // What the primary CTA actually does, by priority.
  type Action = "switch" | "bridge" | "transfer" | "disabled";
  const action: Action = blocker
    ? "disabled"
    : onWrongChain
      ? "switch"
      : mode === "transfer"
        ? "transfer"
        : "bridge";

  const actionLabel = (() => {
    if (running) return mode === "transfer" ? "TRANSFERRING…" : "BRIDGING…";
    if (action === "switch") return `SWITCH TO ${source.label.toUpperCase()}`;
    if (action === "transfer") return "TRANSFER";
    if (action === "bridge") return "BRIDGE NOW";
    return mode === "transfer" ? "TRANSFER" : "BRIDGE NOW";
  })();

  async function onPrimary() {
    if (action === "disabled") return;
    setErrorMsg(null);

    if (action === "switch") {
      try {
        await switchChainAsync({ chainId: source.id as never });
      } catch {
        setErrorMsg(`You declined the network switch. Switch your wallet to ${source.label} to continue.`);
      }
      return;
    }

    setCompletedTxHash(null);
    setSteps(initialSteps());
    setRunning(true);

    try {
      if (action === "transfer") {
        await doTransfer();
      } else {
        await doBridge();
      }
    } catch (err) {
      setErrorMsg(friendlyError(err));
    } finally {
      setRunning(false);
    }
  }

  /// Same-chain USDC.transfer call via viem. No CCTP — just a regular ERC-20
  /// transfer to the recipient address.
  async function doTransfer() {
    if (!walletClient) throw new Error("Wallet not ready. Refresh and try again.");
    const to = recipient.trim() as `0x${string}`;
    const valueWei = parseUnits(amount, 6);
    const hash = await walletClient.writeContract({
      address: source.usdcAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, valueWei],
    });
    setCompletedTxHash(hash);
  }

  async function doBridge() {
    let AppKit: typeof import("@circle-fin/app-kit").AppKit;
    let createViemAdapterFromProvider: typeof import("@circle-fin/adapter-viem-v2").createViemAdapterFromProvider;
    try {
      ({ AppKit } = await import("@circle-fin/app-kit"));
      ({ createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2"));
    } catch {
      throw new Error("BRIDGE_SDK_MISSING");
    }

    const provider = typeof window !== "undefined" ? (window as { ethereum?: unknown }).ethereum : undefined;
    if (!provider) throw new Error("No browser wallet detected. Install MetaMask or another injected wallet.");
    const adapter = await createViemAdapterFromProvider({ provider: provider as never });

    const kit = new AppKit();
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
      to: { adapter, chain: dest.appKitChain as never, useForwarder: true },
      amount,
    });
    if ((result as { state?: string }).state === "error") {
      throw new Error("Bridge failed mid-flight. Check the step strip for which leg failed.");
    }
    const lastSuccess = ((result as { steps?: Array<{ state: string; txHash?: string }> }).steps ?? [])
      .filter((s) => s.state === "success" && s.txHash)
      .at(-1);
    setCompletedTxHash(lastSuccess?.txHash ?? null);
  }

  function friendlyError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw === "BRIDGE_SDK_MISSING" || raw.includes("Cannot find module")) {
      return "Bridge SDK isn't installed. Run `npm install @circle-fin/app-kit @circle-fin/adapter-viem-v2` in the frontend, then reload this page.";
    }
    if (/user rejected|user denied|reject/i.test(raw)) {
      return "You declined the request in your wallet. Try again when ready.";
    }
    if (/insufficient funds|insufficient balance/i.test(raw)) {
      return "Wallet doesn't have enough to cover the transaction. Top up gas or USDC and retry.";
    }
    if (/network/i.test(raw) && /switch/i.test(raw)) {
      return `Your wallet is on the wrong network. Switch to ${source.label} and retry.`;
    }
    if (raw.length > 200) return raw.slice(0, 200) + "…";
    return raw;
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1200px] px-6 pt-16">
        <CornerMarkers />
        <SectionHeader
          eyebrow={
            <span className="flex flex-wrap items-center gap-3">
              <span aria-hidden className="text-accent">■</span>
              {mode === "transfer" ? "TRANSFER" : "BRIDGE"}
              <StatusChip tone="ok">{mode === "transfer" ? "SAME CHAIN" : "CCTP V2"}</StatusChip>
              <span className="text-ink-3">
                {mode === "transfer" ? "· direct usdc transfer" : "· 8 chains · forwarder on"}
              </span>
            </span>
          }
          heading={mode === "transfer" ? "TRANSFER USDC" : "BRIDGE USDC"}
          subDeck={
            mode === "transfer" ? (
              <>send usdc to another address on the same chain. no cctp, just a direct erc-20 transfer.</>
            ) : (
              <>move usdc between testnets via circle bridge kit. forwarder service settles the destination side, no destination wallet needed.</>
            )
          }
        />
      </section>

      <section className="mx-auto max-w-[1200px] px-6 py-10">
        <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
          <FaucetButton address={account} />
        </div>

        <BracketedCell pad="lg" className="flex flex-col gap-6">
          <ChainPicker label="FROM" value={sourceId} onChange={setSourceId} balance={balance} />

          <AmountInput
            value={amount}
            onChange={setAmount}
            sourceCode={source.code}
            onMax={balance !== null ? () => setAmount(String(balance)) : undefined}
          />

          <ChainPicker label="TO" value={destId} onChange={setDestId} />

          {mode === "transfer" ? (
            <RecipientInput
              value={recipient}
              onChange={setRecipient}
              onSelf={account ? () => setRecipient(account) : undefined}
            />
          ) : null}

          {mode === "bridge" && isOutboundFromArc ? (
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
            <TagButton onClick={onPrimary} disabled={action === "disabled" || running || !isConnected}>
              {actionLabel}
            </TagButton>
            <span className="font-mono text-[11px] text-ink-3">
              {action === "switch"
                ? `wallet on ${bridgeChainById(walletChainId)?.label ?? `chain ${walletChainId}`}, source needs ${source.label}.`
                : mode === "transfer"
                  ? "settles in one tx. no bridge fee."
                  : "~8 to 20s on fast routes. fee shown on each step."}
            </span>
          </div>
        </BracketedCell>

        {mode === "bridge" ? <StepStrip steps={steps} running={running} /> : null}

        {errorMsg ? (
          <BracketedCell pad="md" className="mt-6">
            <div className="flex flex-col gap-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
                ■ HEADS UP
              </div>
              <p className="font-mono text-[12px] text-ink-2">{errorMsg}</p>
            </div>
          </BracketedCell>
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
                "relative flex items-center gap-3 border px-3 py-3 text-left font-mono transition-colors",
                isSelected
                  ? "border-accent bg-canvas-2 text-ink"
                  : isExcluded
                    ? "border-[color:var(--hairline)] bg-canvas text-ink-3 opacity-40"
                    : "border-[color:var(--hairline)] bg-canvas text-ink hover:bg-canvas-2",
              ].join(" ")}
            >
              <ChainIcon chain={c} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] uppercase tracking-[0.12em]">{c.code}</div>
                <div className="truncate text-[10px] text-ink-3">{c.label}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RecipientInput({
  value,
  onChange,
  onSelf,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelf?: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
        <span>RECIPIENT</span>
        {onSelf ? (
          <button type="button" onClick={onSelf} className="text-accent hover:text-ink">
            SELF
          </button>
        ) : null}
      </div>
      <input
        type="text"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0x..."
        className="w-full border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 py-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-3"
        aria-label="Recipient address"
      />
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

/// Round chain icon for the picker. Uses llamao.fi's CDN (same source
/// chainlist.org uses) for the standard chains. Arc gets a brand-color tile
/// since it's not yet on the llamao CDN; same for any future chain we add
/// before its icon lands there. The fallback never breaks layout.
function ChainIcon({ chain }: { chain: BridgeChain }) {
  const [errored, setErrored] = useState(false);
  if (chain.iconUrl && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={chain.iconUrl}
        alt=""
        width={28}
        height={28}
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
        className="h-7 w-7 flex-none rounded-full bg-canvas-3 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent font-mono text-[10px] font-medium text-accent-ink"
    >
      {chain.code.slice(0, 3)}
    </span>
  );
}

/// Faucet button that copies the connected wallet address to the clipboard
/// before opening Circle's faucet in a new tab. Circle's faucet doesn't take
/// an address from the URL, so the copy-then-paste flow is the smoothest we
/// can do without a Circle API change.
function FaucetButton({ address }: { address?: `0x${string}` }) {
  const [copied, setCopied] = useState(false);

  async function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (address) {
      try {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard API blocked (rare); just open the faucet anyway.
      }
    }
    window.open("https://faucet.circle.com", "_blank", "noopener,noreferrer");
  }

  const label = !address
    ? "GET TESTNET USDC"
    : copied
      ? "ADDRESS COPIED"
      : "COPY ADDRESS + OPEN FAUCET";

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 border border-ink bg-canvas px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3"
      title={address ? `Copy ${address.slice(0, 10)}…${address.slice(-6)} and open the faucet` : "Open the Circle faucet"}
    >
      {label} <span aria-hidden>↗</span>
    </button>
  );
}
