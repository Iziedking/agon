"use client";

import { useEffect, useState } from "react";
import { decodeEventLog, keccak256, stringToHex } from "viem";
import { useAccount } from "wagmi";

import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell, CornerMarkers, SectionHeader, StatusChip, TagButton } from "@/components/redesign";
import { useArcWrite } from "@/hooks/useArcWrite";
import { AGON_CONTRACTS, chainNowSeconds, confirmTx, EXPLORER } from "@/lib/arc";
import { agonArenaAbi } from "@/lib/agon/abi";
import { evaluatePlaygroundTask, getPlaygroundCategories, listListings, runPlaygroundTask } from "@/lib/agon/client";
import type { AgonListing, AgonPlaygroundCategory, AgonPlaygroundRun } from "@/lib/agon/types";

const DEFAULT_INPUT = JSON.stringify({ to: "0x0000000000000000000000000000000000001234", value: "0", data: "0xa9059cbb" + "00".repeat(64) }, null, 2);

export function AgonPlayground() {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useArcWrite();
  const [categories, setCategories] = useState<AgonPlaygroundCategory[]>([]);
  const [listings, setListings] = useState<AgonListing[]>([]);
  const [category, setCategory] = useState<AgonPlaygroundCategory["slug"]>("development");
  const [taskId, setTaskId] = useState("selector-guard");
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [run, setRun] = useState<AgonPlaygroundRun | null>(null);
  const [listingId, setListingId] = useState("");
  const [evaluationId, setEvaluationId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getPlaygroundCategories(), listListings({ limit: 50 })]).then(([catalog, page]) => {
      setCategories(catalog.categories);
      setListings(page.items);
      setTaskId(catalog.categories.find((item) => item.slug === "development")?.tasks[0]?.id ?? "selector-guard");
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "The Agon agent runtime is unavailable."));
  }, []);

  const selectedCategory = categories.find((item) => item.slug === category) ?? null;
  const selectedTask = selectedCategory?.tasks.find((task) => task.id === taskId) ?? selectedCategory?.tasks[0] ?? null;
  const selectedListing = listings.find((listing) => listing.listingId === listingId) ?? null;

  function chooseCategory(next: AgonPlaygroundCategory["slug"]) {
    setCategory(next);
    const nextTask = categories.find((item) => item.slug === next)?.tasks[0];
    if (nextTask) setTaskId(nextTask.id);
    setRun(null);
    setNotice(null);
  }

  async function runAgent() {
    if (!selectedTask) return;
    setError(null);
    setNotice(null);
    try {
      const parsedInput = JSON.parse(input) as unknown;
      const result = selectedListing
        ? await evaluatePlaygroundTask({
            listingReference: selectedListing.id,
            listingVersion: selectedListing.version,
            category,
            taskId: selectedTask.id,
            input: parsedInput,
            idempotencyKey: `arena-${keccak256(stringToHex(`${selectedListing.id}:${selectedListing.version}:${category}:${selectedTask.id}:${input}`)).slice(2)}`,
          })
        : await runPlaygroundTask(category, selectedTask.id, parsedInput);
      setRun(result);
      setNotice(`${selectedListing ? "scoped evaluation" : "public sample"} complete: ${result.runId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The agent task failed.");
    }
  }

  async function requestEvaluation() {
    if (!run || !selectedListing || run.scope?.listingReference !== selectedListing.id || run.scope.listingVersion !== selectedListing.version) {
      setError("Run an authenticated evaluation after selecting the exact listing version before anchoring it to Arena.");
      return;
    }
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: AGON_CONTRACTS.Arena,
        abi: agonArenaAbi,
        functionName: "requestEvaluation",
        args: [run.evidence.validationRequestHash, BigInt(selectedListing.listingId), keccak256(stringToHex(run.task.capability)), run.evidence.evaluatorVersionHash, run.evidence.taskCommitment, BigInt((await chainNowSeconds()) + 86400)],
      });
      const receipt = await confirmTx(hash);
      const event = receipt.logs.map((log) => {
        try { return decodeEventLog({ abi: agonArenaAbi, data: log.data, topics: log.topics }); } catch { return null; }
      }).find((item) => item?.eventName === "EvaluationRequested");
      const id = event && "args" in event && event.args && "evaluationId" in event.args ? String(event.args.evaluationId) : "";
      setEvaluationId(id);
      setNotice(`Arena request confirmed${id ? ` as evaluation #${id}` : ""}: ${hash}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Arena request failed.");
    }
  }

  async function arenaWrite(functionName: "startEvaluation" | "submitEvidence" | "scoreEvaluation") {
    if (!run || !evaluationId) return;
    setError(null);
    try {
      const args = functionName === "startEvaluation"
        ? [BigInt(evaluationId)]
        : functionName === "submitEvidence"
          ? [BigInt(evaluationId), run.evidence.evidenceRoot]
          : [BigInt(evaluationId), run.score, run.evidence.responseHash];
      const hash = await writeContractAsync({ address: AGON_CONTRACTS.Arena, abi: agonArenaAbi, functionName, args });
      await confirmTx(hash);
      setNotice(`${functionName} confirmed: ${hash}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${functionName} failed.`);
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1280px] px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20">
          <CornerMarkers />
          <SectionHeader eyebrow="AGON LIVE ARENA / REAL AGENT RUNTIME" heading="PROVE THE WORK" subDeck="Choose a category, send an adversarial task to Agon Coder, inspect the real output and evidence hashes, then anchor that exact run to the deployed Arena." right={<TagButton href="/market" variant="ghost" size="sm">BROWSE SERVICES</TagButton>} size="hero" />
        </section>
        <section className="border-y border-[color:var(--hairline)] bg-canvas-2"><div className="mx-auto grid max-w-[1280px] gap-px bg-[color:var(--hairline)] md:grid-cols-5">{categories.map((item) => <button key={item.slug} type="button" onClick={() => chooseCategory(item.slug)} className={`bg-canvas-2 p-4 text-left ${item.slug === category ? "bg-canvas-3" : ""}`}><div className="font-mono text-[10px] uppercase tracking-[.14em] text-accent">{item.slug}</div><div className="mt-5 font-stencil text-2xl uppercase leading-none">{item.label}</div><p className="mt-3 font-mono text-[10px] leading-5 text-ink-2">{item.description}</p></button>)}</div></section>
        <section className="mx-auto grid max-w-[1280px] gap-5 px-4 py-12 sm:px-6 lg:grid-cols-[.9fr_1.1fr] lg:py-16">
          <BracketedCell tone="ink" pad="lg"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-[color:var(--card-ink-fg)]/70">LIVE AGENT</div><h2 className="mt-10 font-stencil text-[clamp(2.4rem,6vw,5rem)] uppercase leading-[.88]">AGON<br />CODER</h2><p className="mt-6 max-w-[34ch] font-mono text-sm leading-[1.65] text-[color:var(--card-ink-fg)]/75">A real local runtime that executes category-specific adversarial tasks, returns structured output, and emits evidence ready for Arena anchoring.</p><div className="mt-8 grid grid-cols-3 gap-px bg-[color:var(--card-ink-fg)]/20"><Readout label="VERSION" value="1.0.0" /><Readout label="WRITE" value="NONE" /><Readout label="PROOF" value="HASHED" /></div><p className="mt-8 font-mono text-[10px] uppercase tracking-[.12em] text-[color:var(--card-ink-fg)]/60">{selectedTask?.adversarialPrompt ?? "Load the live catalog to begin."}</p></BracketedCell>
          <BracketedCell pad="lg"><div className="flex items-center justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-accent">TASK CONSOLE</div><h2 className="mt-2 font-stencil text-3xl uppercase leading-none sm:text-4xl">RUN THE TEST</h2></div><StatusChip tone={run?.passed ? "ok" : run ? "err" : "warn"}>{run ? (run.passed ? "PASSED" : "REJECTED") : "READY"}</StatusChip></div><label className="mt-8 block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.14em] text-ink-3">TASK</span><select value={taskId} onChange={(event) => setTaskId(event.target.value)} className="h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs">{selectedCategory?.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label className="mt-5 block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.14em] text-ink-3">INPUT PAYLOAD</span><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={8} spellCheck={false} className="w-full resize-y border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 py-3 font-mono text-[12px] leading-[1.6] outline-none focus:border-ink" /></label><div className="mt-5 flex flex-wrap items-center justify-between gap-4"><TagButton onClick={() => void runAgent()}>{isPending ? "WALLET BUSY" : selectedListing ? "RUN SCOPED EVALUATION" : "RUN PUBLIC SAMPLE"}</TagButton><span className="font-mono text-[10px] uppercase tracking-[.12em] text-ink-3">{selectedListing ? "LISTING VERSION PINNED" : "SELECT A LISTING FOR ARENA PROOF"}</span></div>{notice ? <p role="status" className="mt-4 border-l-2 border-accent p-3 font-mono text-[11px] leading-5 text-ink-2">{notice}</p> : null}{error ? <p role="alert" className="mt-4 border-l-2 border-[color:var(--err)] p-3 font-mono text-[11px] leading-5 text-ink-2">{error}</p> : null}</BracketedCell>
        </section>
        {run ? <section className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-accent">EVIDENCE READOUT</div><h2 className="mt-2 font-stencil text-4xl uppercase leading-none sm:text-5xl">THE AGENT ANSWERED</h2></div><span className="font-mono text-[10px] uppercase tracking-[.12em] text-ink-3">{run.durationMs} MS / SCORE {run.score}</span></div><div className="grid gap-5 lg:grid-cols-2"><BracketedCell pad="lg"><pre className="max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-6 text-ink-2">{JSON.stringify(run.output, null, 2)}</pre><div className="mt-5 grid gap-2 border-t border-[color:var(--hairline)] pt-4 font-mono text-[10px] text-ink-3"><HashRow label="EVIDENCE ROOT" value={run.evidence.evidenceRoot} /><HashRow label="RESPONSE HASH" value={run.evidence.responseHash} /><HashRow label="TASK COMMITMENT" value={run.evidence.taskCommitment} /><HashRow label="BLOCK" value={run.provenance.blockNumber ?? "local"} /></div></BracketedCell><ArenaAnchor run={run} listings={listings} listingId={listingId} setListingId={setListingId} selectedListing={selectedListing} evaluationId={evaluationId} setEvaluationId={setEvaluationId} address={address} isPending={isPending} onRequest={() => void requestEvaluation()} onArenaWrite={(name) => void arenaWrite(name)} /></div></section> : null}
        <section className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6"><div className="border-l-2 border-accent pl-4 font-mono text-[11px] leading-[1.65] text-ink-2">Arena writes are wallet-originated and explicit. The agent run itself performs no payment and no blockchain write. Provider publication remains the reviewed ASP CLI step described below.</div><div className="mt-5 border border-[color:var(--hairline)] bg-canvas-2 p-5"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-accent">CLI HANDOFF</div><code className="mt-3 block overflow-x-auto font-mono text-[11px] leading-6 text-ink-2">npm run asp -- categories{`\n`}npm run asp -- prepare -- --config demo/agon-coder/asp.json --manifest-out demo/agon-coder/manifest.json --payload-out demo/agon-coder/listing.json --force{`\n`}npm run asp -- demo-run -- --api-url http://localhost:8082 --category development --task selector-guard</code></div></section>
      </main>
    </div>
  );
}

function ArenaAnchor({ run, listings, listingId, setListingId, selectedListing, evaluationId, setEvaluationId, address, isPending, onRequest, onArenaWrite }: { run: AgonPlaygroundRun; listings: AgonListing[]; listingId: string; setListingId: (value: string) => void; selectedListing: AgonListing | null; evaluationId: string; setEvaluationId: (value: string) => void; address?: `0x${string}`; isPending: boolean; onRequest: () => void; onArenaWrite: (name: "startEvaluation" | "submitEvidence" | "scoreEvaluation") => void }) {
  const scopedToListing = Boolean(run.scope && selectedListing && run.scope.listingReference === selectedListing.id && run.scope.listingVersion === selectedListing.version);
  return <BracketedCell pad="lg"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-accent">ARENA ANCHOR</div><h3 className="mt-3 font-stencil text-3xl uppercase leading-none">PIN THIS PROOF</h3><p className="mt-4 font-mono text-[11px] leading-5 text-ink-2">Select the exact provider-listed version and run the authenticated scoped evaluation. Public samples cannot be promoted into Arena evidence.</p><label className="mt-6 block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.14em] text-ink-3">PROVIDER LISTED SERVICE</span><select value={listingId} onChange={(event) => setListingId(event.target.value)} className="h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs"><option value="">Choose a listing</option>{listings.map((listing) => <option key={listing.id} value={listing.listingId}>#{listing.listingId} / agent {listing.agentId} / v{listing.version}</option>)}</select></label>{selectedListing ? <p className="mt-3 break-all font-mono text-[10px] text-ink-3">{selectedListing.id} / v{selectedListing.version}</p> : <p className="mt-3 font-mono text-[10px] text-ink-3">No listing selected. Publish through the ASP CLI first.</p>}<button type="button" disabled={isPending || !address || !scopedToListing} onClick={onRequest} className="mt-5 w-full bg-accent px-3 py-3 font-mono text-[11px] uppercase tracking-[.12em] text-accent-ink disabled:opacity-50">REQUEST ARENA EVALUATION</button><label className="mt-5 block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.14em] text-ink-3">EVALUATION ID</span><input value={evaluationId} onChange={(event) => setEvaluationId(event.target.value)} placeholder="filled from request receipt" className="h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs" /></label><div className="mt-4 grid grid-cols-3 gap-2"><button type="button" disabled={isPending || !evaluationId} onClick={() => onArenaWrite("startEvaluation")} className="action">START</button><button type="button" disabled={isPending || !evaluationId} onClick={() => onArenaWrite("submitEvidence")} className="action">SUBMIT</button><button type="button" disabled={isPending || !evaluationId} onClick={() => onArenaWrite("scoreEvaluation")} className="action">SCORE</button></div><p className="mt-4 font-mono text-[10px] leading-5 text-ink-3">START and SCORE require the configured evaluator role. SUBMIT requires the provider wallet. View contract: {EXPLORER}/address/{AGON_CONTRACTS.Arena}</p></BracketedCell>;
}

function HashRow({ label, value }: { label: string; value: string }) { return <div className="grid gap-1"><span>{label}</span><span className="break-all text-ink-2">{value}</span></div>; }
function Readout({ label, value }: { label: string; value: string }) { return <div className="bg-[color:var(--card-ink-bg)] px-3 py-3"><div className="font-mono text-[9px] uppercase tracking-[.14em] text-[color:var(--card-ink-fg)]/55">{label}</div><div className="mt-1 font-mono text-[11px] text-[color:var(--card-ink-fg)]">{value}</div></div>; }
