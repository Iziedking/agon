"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useBalance, useReadContract, useSwitchChain, useWalletClient } from "wagmi";
import { erc20Abi, formatUnits, isAddress, parseUnits } from "viem";

import { BracketedCell, StatusChip, TagButton } from "@/components/redesign";
import { useAuth } from "@/hooks/useAuth";
import type { config as wagmiConfig } from "@/lib/wagmi";
import {
  ARC_OUTBOUND_MIN_USDC,
  BRIDGE_CHAINS,
  BRIDGE_STEPS,
  bridgeChainById,
  fetchTopUpDepositAddress,
  fetchTopUpStatus,
  postTopUpBridge,
  type BridgeChain,
  type BridgeStepProgress,
} from "@/lib/bridge";

/// Funds module for the dashboard: TOP UP (bring USDC into your Arc balance) and
/// WITHDRAW (send it back out to a supported chain). Replaces the old standalone
/// "bridge" page — same Circle App Kit / CCTP plumbing, framed the way users
/// actually think. Branches on the account type: web3-wallet users sign in the
/// browser; email (Circle custodial) users have the backend sign, including a
/// deposit-address + auto-bridge flow for topping up from another chain.

const ARC = BRIDGE_CHAINS.find((c) => c.code === "ARC")!;
const ARC_ID = ARC.id;
const DEFAULT_OTHER = BRIDGE_CHAINS.find((c) => c.code === "BASE")!.id;
const USDC_ON_ARC = "0x3600000000000000000000000000000000000000" as const;

type Tab = "topup" | "withdraw";

export function FundsPanel() {
  const { me } = useAuth();
  const isCircle = me?.walletKind === "circle";
  const [tab, setTab] = useState<Tab>("topup");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> FUNDS
          <span className="ml-2 text-ink-3">· move usdc in and out</span>
        </span>
        <TabToggle tab={tab} onChange={setTab} />
      </div>
      {isCircle ? <CircleFunds tab={tab} /> : <WagmiFunds tab={tab} />}
    </div>
  );
}

function TabToggle({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex gap-2">
      {(["topup", "withdraw"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={[
            "border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
            tab === t
              ? "border-accent bg-accent text-accent-ink"
              : "border-[color:var(--hairline-strong)] bg-canvas text-ink hover:bg-canvas-2",
          ].join(" ")}
        >
          {t === "topup" ? "TOP UP" : "WITHDRAW"}
        </button>
      ))}
    </div>
  );
}

/// ---------------------------------------------------------------------------
/// Web3-wallet users: the browser-signed CCTP bridge, constrained by tab.
///   TOP UP   = pick a source chain, destination fixed to Arc.
///   WITHDRAW = source fixed to Arc, pick a destination chain.
/// Always a cross-chain bridge (Arc is one side either way); the destination
/// mint is handled by the Forwarding Service, so no second wallet is needed.
/// ---------------------------------------------------------------------------
function WagmiFunds({ tab }: { tab: Tab }) {
  const { address: account, isConnected, chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const isTopUp = tab === "topup";
  const [otherId, setOtherId] = useState<number>(DEFAULT_OTHER);
  const [amount, setAmount] = useState("1.00");
  const [useCustomRecipient, setUseCustomRecipient] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [steps, setSteps] = useState<BridgeStepProgress[]>(initialSteps());
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completedTxHash, setCompletedTxHash] = useState<string | null>(null);

  // Arc is always one side; the other side is the picker.
  const source = isTopUp ? bridgeChainById(otherId)! : ARC;
  const dest = isTopUp ? ARC : bridgeChainById(otherId)!;
  const isOutboundFromArc = source.id === ARC_ID;
  void walletClient; // reserved for a future same-chain send

  const { data: balanceWei } = useReadContract({
    abi: erc20Abi,
    address: source.usdcAddress,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId: source.id as never,
    query: { enabled: Boolean(account), refetchInterval: 12_000 },
  });
  const balance = useMemo(
    () => (typeof balanceWei === "bigint" ? Number(formatUnits(balanceWei, 6)) : null),
    [balanceWei],
  );

  const amountNum = Number(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const meetsArcOutboundMin = !isOutboundFromArc || amountNum >= ARC_OUTBOUND_MIN_USDC;
  const insufficient = !running && balance !== null && validAmount && amountNum > balance;
  const recipientIsAddress = recipient.trim().length > 0 && isAddress(recipient.trim());
  const validRecipient = !useCustomRecipient || recipientIsAddress;
  const bridgeRecipient: `0x${string}` | undefined =
    useCustomRecipient && recipientIsAddress ? (recipient.trim() as `0x${string}`) : account;
  const onWrongChain = isConnected && walletChainId !== source.id;

  const blocker = !validAmount
    ? "Enter an amount greater than 0."
    : !meetsArcOutboundMin
      ? `Out-of-Arc transfers must exceed ~${ARC_OUTBOUND_MIN_USDC} USDC (CCTPv2 max fee).`
      : insufficient
        ? `Not enough USDC on ${source.label}.`
        : !account
          ? "Connect a wallet first."
          : !validRecipient
            ? "Enter a valid destination wallet, or send to your own."
            : null;

  const action: "switch" | "bridge" | "disabled" = blocker ? "disabled" : onWrongChain ? "switch" : "bridge";
  const label = running
    ? isTopUp ? "TOPPING UP…" : "WITHDRAWING…"
    : action === "switch"
      ? `SWITCH TO ${source.label.toUpperCase()}`
      : isTopUp ? "TOP UP →" : "WITHDRAW →";

  async function onPrimary() {
    if (action === "disabled") return;
    setErrorMsg(null);
    if (action === "switch") {
      try {
        await switchChainAsync({ chainId: source.id as never });
      } catch {
        setErrorMsg(`Switch your wallet to ${source.label} to continue.`);
      }
      return;
    }
    setCompletedTxHash(null);
    setSteps(initialSteps());
    setRunning(true);
    try {
      await doBridge();
    } catch (err) {
      setErrorMsg(friendlyError(err, source.label));
    } finally {
      setRunning(false);
    }
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
    let burnSettled = false;
    const stepHandler = (name: BridgeStepProgress["name"]) => (payload: unknown) => {
      const p = payload as { values?: { state?: BridgeStepProgress["state"]; txHash?: string; explorerUrl?: string; error?: string } };
      updateStep(setSteps, name, {
        state: p.values?.state ?? "pending",
        txHash: p.values?.txHash,
        explorerUrl: p.values?.explorerUrl,
        error: p.values?.error,
      });
      if (name === "burn" && p.values?.state === "success" && !burnSettled) {
        burnSettled = true;
        updateStep(setSteps, "fetchAttestation", { state: "forwarded" });
        updateStep(setSteps, "mint", { state: "forwarded" });
        setCompletedTxHash(p.values.txHash ?? null);
        setRunning(false);
      }
    };
    kit.on("bridge.approve", stepHandler("approve"));
    kit.on("bridge.burn", stepHandler("burn"));
    kit.on("bridge.fetchAttestation", stepHandler("fetchAttestation"));
    kit.on("bridge.mint", stepHandler("mint"));
    try {
      const result = await kit.bridge({
        from: { adapter, chain: source.appKitChain as never },
        to: {
          adapter,
          chain: dest.appKitChain as never,
          useForwarder: true,
          ...(bridgeRecipient ? { recipientAddress: bridgeRecipient } : {}),
        },
        amount,
      });
      if (burnSettled) return;
      if ((result as { state?: string }).state === "error") {
        throw new Error("Transfer failed mid-flight. Check the step strip for which leg failed.");
      }
      const lastSuccess = ((result as { steps?: Array<{ state: string; txHash?: string }> }).steps ?? [])
        .filter((s) => s.state === "success" && s.txHash)
        .at(-1);
      setCompletedTxHash(lastSuccess?.txHash ?? null);
    } catch (err) {
      if (burnSettled) return;
      throw err;
    }
  }

  return (
    <BracketedCell pad="lg" className="flex flex-col gap-6">
      <ChainPicker
        label={isTopUp ? "FROM CHAIN" : "TO CHAIN"}
        value={otherId}
        onChange={setOtherId}
        balance={isTopUp ? balance : undefined}
        excludeArc
      />

      <AmountInput
        value={amount}
        onChange={setAmount}
        sourceCode={source.code}
        onMax={balance !== null ? () => setAmount(String(balance)) : undefined}
      />

      <BridgeRecipient
        account={account}
        useCustom={useCustomRecipient}
        setUseCustom={setUseCustomRecipient}
        value={recipient}
        onChange={setRecipient}
        invalid={useCustomRecipient && recipient.trim().length > 0 && !isAddress(recipient.trim())}
        sideLabel={isTopUp ? "arc wallet" : "destination wallet"}
      />

      {isOutboundFromArc ? (
        <div className="border-l-2 border-accent bg-canvas-2 px-4 py-3 font-mono text-[11px] text-ink-2">
          <span className="text-accent">NOTE</span> · withdrawals off Arc must be at least ~{ARC_OUTBOUND_MIN_USDC} USDC.
        </div>
      ) : null}

      {blocker ? (
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">{blocker}</div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <TagButton onClick={onPrimary} disabled={action === "disabled" || running || !isConnected}>
          {label}
        </TagButton>
        <span className="font-mono text-[11px] text-ink-3">
          {action === "switch"
            ? `wallet on ${bridgeChainById(walletChainId)?.label ?? `chain ${walletChainId}`}, needs ${source.label}.`
            : "~8 to 20s on fast routes."}
        </span>
      </div>

      <StepStrip steps={steps} running={running} />

      {errorMsg ? (
        <div className="border-l-2 border-[color:var(--err)] bg-canvas-2 px-4 py-3 font-mono text-[12px] text-ink-2">
          <span className="text-accent">HEADS UP</span> · {errorMsg}
        </div>
      ) : null}
      {completedTxHash ? (
        <div className="flex flex-wrap items-center gap-3 font-mono text-[12px]">
          <span className="text-accent">■</span>
          <span className="text-ink">{isTopUp ? "TOP UP COMPLETE" : "WITHDRAWAL COMPLETE"}</span>
          <span className="text-ink-3">·</span>
          <a href={`${dest.explorer}/tx/${completedTxHash}`} target="_blank" rel="noreferrer" className="text-ink-2 hover:text-accent">
            view tx ↗
          </a>
        </div>
      ) : null}

      <GasFaucetCard chain={source} />
    </BracketedCell>
  );
}

/// ---------------------------------------------------------------------------
/// Email (Circle custodial) users: the backend signs.
///   TOP UP   = receive USDC straight to your Arc wallet, OR fund a deposit
///              address on another chain and we auto-bridge it to Arc.
///   WITHDRAW = transfer to another Arc address, or bridge out to a chain.
/// ---------------------------------------------------------------------------
function CircleFunds({ tab }: { tab: Tab }) {
  if (tab === "topup") return <CircleTopUp />;
  return <CircleWithdraw />;
}

function useArcBalance(address?: `0x${string}`) {
  const { data } = useReadContract({
    abi: erc20Abi,
    address: USDC_ON_ARC,
    chainId: ARC_ID as never,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 12_000 },
  });
  return typeof data === "bigint" ? Number(formatUnits(data, 6)) : null;
}

function CircleTopUp() {
  const { me } = useAuth();
  const address = me?.address as `0x${string}` | undefined;
  const arcBalanceNum = useArcBalance(address);

  // Cross-chain deposit flow state.
  const [sourceId, setSourceId] = useState<number>(DEFAULT_OTHER);
  const [amount, setAmount] = useState("2.00");
  const [depositAddr, setDepositAddr] = useState<`0x${string}` | null>(null);
  const [deposited, setDeposited] = useState<number>(0);
  const [phase, setPhase] = useState<"idle" | "awaiting" | "bridging" | "done">("idle");
  const [steps, setSteps] = useState<BridgeStepProgress[]>(initialSteps());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const firedRef = useRef(false);

  const source = bridgeChainById(sourceId)!;
  const amountNum = Number(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;

  // Poll the deposit wallet while awaiting funds; auto-fire the bridge once the
  // balance covers the requested amount.
  useEffect(() => {
    if (phase !== "awaiting") return;
    let live = true;
    const tick = async () => {
      try {
        const s = await fetchTopUpStatus(source.appKitChain);
        if (!live) return;
        setDeposited(s.usdc);
        if (s.usdc >= amountNum && !firedRef.current) {
          firedRef.current = true;
          void runBridge();
        }
      } catch {
        /* transient; keep polling */
      }
    };
    void tick();
    const id = setInterval(tick, 8000);
    return () => {
      live = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, source.appKitChain, amountNum]);

  async function getDepositAddress() {
    setError(null);
    firedRef.current = false;
    try {
      const d = await fetchTopUpDepositAddress(source.appKitChain);
      setDepositAddr(d.address);
      setDeposited(0);
      setPhase("awaiting");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runBridge() {
    setPhase("bridging");
    setSteps(initialSteps());
    try {
      const res = await postTopUpBridge(source.appKitChain, amount);
      setSteps(stepsFromResult(res.steps));
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("awaiting"); // let them retry once funds are confirmed
      firedRef.current = false;
    }
  }

  async function copyAddr() {
    if (!depositAddr) return;
    try {
      await navigator.clipboard.writeText(depositAddr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Arc-direct: simplest top up, no bridge. */}
      <BracketedCell pad="lg" className="flex flex-col gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> RECEIVE ON ARC
          <span className="ml-2 text-ink-3">· instant, no bridge</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">YOUR ARC WALLET</div>
            <div className="mt-1 break-all font-mono text-[13px] text-ink">{address ?? "loading…"}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">USDC ON ARC</div>
            <div className="mt-1 font-stencil leading-none text-ink" style={{ fontSize: "clamp(28px, 5vw, 44px)" }}>
              {arcBalanceNum === null ? "—" : arcBalanceNum.toFixed(4)}
            </div>
          </div>
        </div>
        <p className="font-mono text-[12px] leading-[1.55] text-ink-2">
          send usdc on arc straight to your wallet address above, or grab free testnet usdc from the faucet.
        </p>
        <FaucetButton address={address} />
      </BracketedCell>

      {/* Cross-chain: deposit on another chain, we bridge it to Arc. */}
      <BracketedCell pad="lg" className="flex flex-col gap-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> FROM ANOTHER CHAIN
          <span className="ml-2 text-ink-3">· we bridge it to arc for you</span>
        </div>

        <ChainPicker label="DEPOSIT FROM" value={sourceId} onChange={(id) => { setSourceId(id); setPhase("idle"); setDepositAddr(null); }} excludeArc disabled={phase === "bridging"} />

        <AmountInput value={amount} onChange={setAmount} sourceCode={source.code} />

        {phase === "idle" ? (
          <div className="flex flex-wrap items-center gap-3">
            <TagButton onClick={getDepositAddress} disabled={!validAmount}>
              GET DEPOSIT ADDRESS →
            </TagButton>
            <span className="font-mono text-[11px] text-ink-3">we make you a one-time address on {source.label}.</span>
          </div>
        ) : null}

        {depositAddr && phase !== "idle" ? (
          <div className="flex flex-col gap-3 border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 py-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              SEND {amount} USDC ON {source.label.toUpperCase()} TO
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="break-all font-mono text-[13px] text-ink">{depositAddr}</span>
              <button
                type="button"
                onClick={copyAddr}
                className="border border-[color:var(--hairline)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:bg-canvas"
              >
                {copied ? "COPIED" : "COPY"}
              </button>
            </div>
            <div className="font-mono text-[11px] text-ink-2">
              {phase === "awaiting"
                ? deposited > 0
                  ? `seen ${deposited.toFixed(4)} USDC · waiting for ${amount}…`
                  : "waiting for your deposit. it bridges to arc automatically once it lands."
                : phase === "bridging"
                  ? "deposit detected. bridging to arc…"
                  : "bridged to arc. your balance updates shortly."}
            </div>
          </div>
        ) : null}

        <StepStrip steps={steps} running={phase === "bridging"} />

        {error ? (
          <div className="border-l-2 border-[color:var(--err)] bg-canvas-2 px-4 py-3 font-mono text-[12px] text-ink-2">
            <span className="text-accent">HEADS UP</span> · {error}
          </div>
        ) : null}
        {phase === "done" ? (
          <div className="font-mono text-[12px] text-ink">
            <span className="text-accent">■</span> TOP UP COMPLETE · usdc is on its way to your arc wallet.
          </div>
        ) : null}
      </BracketedCell>
    </div>
  );
}

function CircleWithdraw() {
  const { me } = useAuth();
  const address = me?.address as `0x${string}` | undefined;
  const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";
  const arcBalanceNum = useArcBalance(address);

  const [mode, setMode] = useState<"same" | "cross">("same");
  const [destId, setDestId] = useState<number>(DEFAULT_OTHER);
  const [amount, setAmount] = useState("1.00");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const dest = bridgeChainById(destId)!;
  const amountNum = Number(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const meetsArcOutboundMin = mode === "same" || amountNum >= ARC_OUTBOUND_MIN_USDC;
  const validRecipient = recipient.trim().length > 0 && isAddress(recipient.trim());
  const insufficient = arcBalanceNum !== null && validAmount && amountNum > arcBalanceNum;

  const blocker = !validAmount
    ? "Enter an amount greater than 0."
    : !validRecipient
      ? "Enter a recipient address."
      : !meetsArcOutboundMin
        ? `Cross-chain withdrawals must be at least ~${ARC_OUTBOUND_MIN_USDC} USDC.`
        : insufficient
          ? "Not enough USDC on Arc."
          : null;

  async function onSubmit() {
    if (blocker) return;
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      if (mode === "same") {
        const res = await fetch(`${AUTH_URL}/wallet/execute`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contractAddress: USDC_ON_ARC,
            abiFunctionSignature: "transfer(address,uint256)",
            abiParameters: [recipient.trim(), String(parseUnits(amount, 6))],
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
        if (!res.ok) throw new Error(data.error ?? `transfer failed (${res.status})`);
        setSuccessMsg(`Transfer submitted. Circle tx id: ${data.id ?? "queued"}.`);
      } else {
        const res = await fetch(`${AUTH_URL}/wallet/bridge`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ destChain: dest.appKitChain, amount, recipientAddress: recipient.trim() }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          steps?: Array<{ name: string; state: string; txHash?: string }>;
        };
        if (!res.ok) throw new Error(data.error ?? `bridge failed (${res.status})`);
        const lastTx = (data.steps ?? []).filter((s) => s.state === "success" && s.txHash).at(-1)?.txHash;
        setSuccessMsg(
          lastTx ? `Withdrawal submitted. Last tx ${lastTx.slice(0, 10)}…${lastTx.slice(-6)}.` : "Withdrawal submitted; check Circle for status.",
        );
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setErrorMsg(raw.length > 200 ? raw.slice(0, 200) + "…" : raw);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BracketedCell pad="lg" className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">YOUR ARC WALLET</div>
          <div className="mt-1 break-all font-mono text-[13px] text-ink">{address ?? "loading…"}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">USDC ON ARC</div>
          <div className="mt-1 font-stencil leading-none text-ink" style={{ fontSize: "clamp(28px, 5vw, 44px)" }}>
            {arcBalanceNum === null ? "—" : arcBalanceNum.toFixed(4)}
          </div>
        </div>
      </div>

      <div className="border-t border-[color:var(--hairline)] pt-5">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">DESTINATION</div>
        <div className="flex flex-wrap gap-2">
          <ModePill active={mode === "same"} onClick={() => setMode("same")}>ANOTHER ARC WALLET</ModePill>
          <ModePill active={mode === "cross"} onClick={() => setMode("cross")}>ANOTHER CHAIN</ModePill>
        </div>
      </div>

      <AmountInput
        value={amount}
        onChange={setAmount}
        sourceCode="ARC"
        onMax={arcBalanceNum !== null ? () => setAmount(String(arcBalanceNum)) : undefined}
      />

      {mode === "cross" ? (
        <ChainPicker label="TO CHAIN" value={destId} onChange={setDestId} excludeArc />
      ) : null}

      <div>
        <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          <span>RECIPIENT</span>
          {address && mode === "same" ? (
            <button type="button" onClick={() => setRecipient(address)} className="text-accent hover:text-ink">SELF</button>
          ) : null}
        </div>
        <input
          type="text"
          spellCheck={false}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x..."
          className="w-full border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 py-3 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3"
          aria-label="Recipient address"
        />
      </div>

      {blocker ? <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">{blocker}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <TagButton onClick={onSubmit} disabled={busy || Boolean(blocker)}>
          {busy ? (mode === "same" ? "SENDING…" : "WITHDRAWING…") : mode === "same" ? "SEND →" : "WITHDRAW →"}
        </TagButton>
        <span className="font-mono text-[11px] text-ink-3">
          {mode === "same" ? "settles in one transaction." : "~8 to 20s on fast routes."}
        </span>
      </div>

      {errorMsg ? (
        <div className="border-l-2 border-[color:var(--err)] bg-canvas-2 px-4 py-3 font-mono text-[12px] text-ink-2">
          <span className="text-accent">HEADS UP</span> · {errorMsg}
        </div>
      ) : null}
      {successMsg ? (
        <div className="border-l-2 border-[color:var(--ok)] bg-canvas-2 px-4 py-3 font-mono text-[12px] text-ink-2">
          <span style={{ color: "var(--ok)" }}>OK</span> · {successMsg}
        </div>
      ) : null}
    </BracketedCell>
  );
}

/// ---- shared bits (moved from the old bridge page) -------------------------

function stepsFromResult(steps: Array<{ name: string; state: string; txHash?: string; explorerUrl?: string }>): BridgeStepProgress[] {
  const base = initialSteps();
  for (const s of steps) {
    const idx = base.findIndex((b) => b.name === s.name);
    if (idx >= 0) {
      base[idx] = {
        name: base[idx]!.name,
        state: (s.state as BridgeStepProgress["state"]) ?? "idle",
        txHash: s.txHash,
        explorerUrl: s.explorerUrl,
      };
    }
  }
  return base;
}

function friendlyError(err: unknown, sourceLabel: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw === "BRIDGE_SDK_MISSING" || raw.includes("Cannot find module")) {
    return "Wallet bridge SDK isn't installed. Run `npm install @circle-fin/app-kit @circle-fin/adapter-viem-v2` in the frontend, then reload.";
  }
  if (/user rejected|user denied|reject/i.test(raw)) return "You declined the request in your wallet. Try again when ready.";
  if (/insufficient funds|insufficient balance/i.test(raw)) return "Wallet doesn't have enough to cover the transaction. Top up gas or USDC and retry.";
  if (/network/i.test(raw) && /switch/i.test(raw)) return `Your wallet is on the wrong network. Switch to ${sourceLabel} and retry.`;
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
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

const GAS_DUST_THRESHOLD = 0.0005;

function GasFaucetCard({ chain }: { chain: BridgeChain }) {
  const { address } = useAccount();
  const { data: native } = useBalance({
    address,
    chainId: chain.id as (typeof wagmiConfig)["chains"][number]["id"],
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });
  if (!chain.gasFaucetUrl || !address || !native) return null;
  const hasGas = Number(formatUnits(native.value, native.decimals)) >= GAS_DUST_THRESHOLD;
  if (hasGas) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border border-[color:var(--hairline)] px-4 py-3">
      <ChainIcon chain={chain} />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> NEED GAS?
        </div>
        <div className="truncate font-mono text-[10px] text-ink-3">claim free testnet gas on {chain.label.toLowerCase()}</div>
      </div>
      <a
        href={chain.gasFaucetUrl}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-2 border border-[color:var(--hairline)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-2"
      >
        CLAIM FAUCET <span aria-hidden className="text-ink-3 group-hover:text-accent">↗</span>
      </a>
    </div>
  );
}

function ChainPicker({
  label,
  value,
  onChange,
  balance,
  excludeArc,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (id: number) => void;
  balance?: number | null;
  excludeArc?: boolean;
  disabled?: boolean;
}) {
  const chains = excludeArc ? BRIDGE_CHAINS.filter((c) => c.id !== ARC_ID) : BRIDGE_CHAINS;
  return (
    <div className={disabled ? "opacity-60" : ""}>
      <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
        <span>{label}</span>
        {balance !== undefined && balance !== null ? <span className="text-ink-2">balance: {balance.toFixed(4)} USDC</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {chains.map((c) => {
          const selected = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(c.id)}
              className={[
                "flex items-center gap-3 border px-3 py-3 text-left font-mono transition-colors",
                selected ? "border-accent bg-canvas-2 text-ink" : "border-[color:var(--hairline)] bg-canvas text-ink hover:bg-canvas-2",
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

function BridgeRecipient({
  account,
  useCustom,
  setUseCustom,
  value,
  onChange,
  invalid,
  sideLabel,
}: {
  account?: `0x${string}`;
  useCustom: boolean;
  setUseCustom: (v: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  sideLabel: string;
}) {
  const short = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "your wallet";
  return (
    <div>
      <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
        <span>{sideLabel.toUpperCase()}</span>
        <button type="button" onClick={() => setUseCustom(!useCustom)} className="text-accent hover:text-ink">
          {useCustom ? "USE MY WALLET" : "SEND TO ANOTHER WALLET"}
        </button>
      </div>
      {useCustom ? (
        <>
          <input
            type="text"
            spellCheck={false}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0x... destination address"
            className="w-full border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 py-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-3"
            aria-label="Destination wallet address"
          />
          {invalid ? <p className="mt-1 font-mono text-[10px] text-accent">that doesn&apos;t look like a valid address.</p> : null}
        </>
      ) : (
        <div className="flex items-center gap-2 border border-[color:var(--hairline)] bg-canvas-2 px-4 py-3 font-mono text-[13px] text-ink-2">
          <span aria-hidden className="text-accent">■</span>
          <span>lands in your connected wallet</span>
          <span className="text-ink">{short}</span>
        </div>
      )}
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
        {onMax ? <button type="button" onClick={onMax} className="text-accent hover:text-ink">MAX</button> : null}
      </div>
      <div className="flex items-center gap-3 border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 py-3">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(sanitizeAmount(e.target.value))}
          className="w-full bg-transparent font-stencil text-[36px] text-ink outline-none"
          aria-label="Amount"
        />
        <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-3">USDC / {sourceCode}</span>
      </div>
    </div>
  );
}

function sanitizeAmount(v: string): string {
  const trimmed = v.replace(/[^0-9.]/g, "");
  const parts = trimmed.split(".");
  if (parts.length <= 1) return trimmed;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function StepStrip({ steps, running }: { steps: BridgeStepProgress[]; running: boolean }) {
  const anyActive = running || steps.some((s) => s.state !== "idle");
  if (!anyActive) return null;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
      {steps.map((s) => {
        const label = BRIDGE_STEPS.find((x) => x.name === s.name)?.label ?? s.name;
        const tone =
          s.state === "success"
            ? "border-accent bg-canvas-2 text-ink"
            : s.state === "forwarded"
              ? "border-[color:var(--ok)] bg-canvas-2 text-ink"
              : s.state === "error"
                ? "border-[color:var(--err)] text-ink"
                : s.state === "pending"
                  ? "border-[color:var(--warn)] text-ink-2"
                  : "border-[color:var(--hairline)] text-ink-3";
        return (
          <div key={s.name} className={`border ${tone} flex flex-col gap-1 px-3 py-3 font-mono`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.12em]">{label}</span>
              <span className="text-[10px] uppercase tracking-[0.12em] text-ink-3">{s.state === "forwarded" ? "AUTO" : s.state}</span>
            </div>
            {s.txHash && s.explorerUrl ? (
              <a href={s.explorerUrl} target="_blank" rel="noreferrer" className="truncate text-[10px] text-ink-2 hover:text-accent">
                {s.txHash.slice(0, 10)}…{s.txHash.slice(-6)} ↗
              </a>
            ) : null}
            {s.error ? <span className="text-[10px] text-[color:var(--err)]">{s.error}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function ModePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
        active ? "border-accent bg-accent text-accent-ink" : "border-[color:var(--hairline-strong)] bg-canvas text-ink hover:bg-canvas-2",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

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
        className="h-7 w-7 flex-none rounded-md object-cover"
      />
    );
  }
  return (
    <span aria-hidden className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-accent font-mono text-[10px] font-medium text-accent-ink">
      {chain.code.slice(0, 3)}
    </span>
  );
}

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
        /* clipboard blocked */
      }
    }
    window.open("https://faucet.circle.com", "_blank", "noopener,noreferrer");
  }
  const label = !address ? "GET TESTNET USDC" : copied ? "ADDRESS COPIED" : "COPY ADDRESS AND CLAIM FAUCET";
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-2 border border-ink bg-canvas px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3"
    >
      {label} <span aria-hidden>↗</span>
    </button>
  );
}
