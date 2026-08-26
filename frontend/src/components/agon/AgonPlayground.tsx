"use client";

import { useEffect, useState } from "react";
import { decodeEventLog, keccak256, stringToHex } from "viem";
import { useAccount } from "wagmi";

import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell, CornerMarkers, SectionHeader, StatusChip, TagButton } from "@/components/redesign";
import { useArcWrite } from "@/hooks/useArcWrite";
import { AGON_CONTRACTS, chainNowSeconds, confirmTx } from "@/lib/arc";
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
      setNotice(`Verification request confirmed${id ? ` as test #${id}` : ""}. AGON will complete the independent review.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Arena request failed.");
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1280px] px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20">
          <CornerMarkers />
          <SectionHeader eyebrow="AGON PLAYGROUND" heading="TEST AN AGENT" subDeck="Choose a category challenge, run a public sample or test one exact listed agent, then inspect the result." right={<TagButton href="/market" variant="ghost" size="sm">BROWSE AGENTS</TagButton>} size="hero" />
        </section>
        <section className="border-y border-[color:var(--hairline)] bg-canvas-2"><div className="mx-auto grid max-w-[1280px] gap-px bg-[color:var(--hairline)] md:grid-cols-5">{categories.map((item) => <button key={item.slug} type="button" onClick={() => chooseCategory(item.slug)} className={`bg-canvas-2 p-4 text-left ${item.slug === category ? "bg-canvas-3" : ""}`}><div className="font-mono text-[10px] uppercase tracking-[.14em] text-accent">{item.slug}</div><div className="mt-5 font-stencil text-2xl uppercase leading-none">{item.label}</div><p className="mt-3 font-mono text-[10px] leading-5 text-ink-2">{item.description}</p></button>)}</div></section>
        <section className="mx-auto grid max-w-[1280px] gap-5 px-4 py-12 sm:px-6 lg:grid-cols-[.9fr_1.1fr] lg:py-16">
          <BracketedCell tone="ink" pad="lg"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-[color:var(--card-ink-fg)]/70">LIVE TEST AGENT</div><h2 className="mt-10 font-stencil text-[clamp(2.4rem,6vw,5rem)] uppercase leading-[.88]">AGON<br />CODER</h2><p className="mt-6 max-w-[34ch] font-mono text-sm leading-[1.65] text-[color:var(--card-ink-fg)]/75">Runs category-specific challenges, returns a structured answer, and creates a tamper-evident result for the selected service version.</p><div className="mt-8 grid grid-cols-3 gap-px bg-[color:var(--card-ink-fg)]/20"><Readout label="VERSION" value="1.0.0" /><Readout label="PAYMENT" value="NONE" /><Readout label="RESULT" value="RECORDED" /></div><p className="mt-8 font-mono text-[10px] uppercase tracking-[.12em] text-[color:var(--card-ink-fg)]/60">{selectedTask?.adversarialPrompt ?? "Load the live catalog to begin."}</p></BracketedCell>
          <BracketedCell pad="lg"><div className="flex items-center justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-accent">TEST SETUP</div><h2 className="mt-2 font-stencil text-3xl uppercase leading-none sm:text-4xl">RUN THE CHALLENGE</h2></div><StatusChip tone={run?.passed ? "ok" : run ? "err" : "warn"}>{run ? (run.passed ? "PASSED" : "DID NOT PASS") : "READY"}</StatusChip></div><label className="mt-8 block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.14em] text-ink-3">AGENT TO TEST</span><select value={listingId} onChange={(event) => { setListingId(event.target.value); setRun(null); setNotice(null); }} className="h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs"><option value="">Public sample, no listed agent</option>{listings.map((listing) => <option key={listing.id} value={listing.listingId}>Agent #{listing.agentId} / service {listing.listingId} / version {listing.version}</option>)}</select></label><label className="mt-5 block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.14em] text-ink-3">CHALLENGE</span><select value={taskId} onChange={(event) => setTaskId(event.target.value)} className="h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 font-mono text-xs">{selectedCategory?.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label className="mt-5 block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.14em] text-ink-3">TEST INPUT</span><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={8} spellCheck={false} className="w-full resize-y border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 py-3 font-mono text-[12px] leading-[1.6] outline-none focus:border-ink" /></label><div className="mt-5 flex flex-wrap items-center justify-between gap-4"><TagButton onClick={() => void runAgent()}>{selectedListing ? "TEST THIS AGENT" : "RUN PUBLIC SAMPLE"}</TagButton><span className="font-mono text-[10px] uppercase tracking-[.12em] text-ink-3">{selectedListing ? `VERSION ${selectedListing.version} SELECTED` : "NO WALLET OR PAYMENT NEEDED"}</span></div>{notice ? <p role="status" className="mt-4 border-l-2 border-accent p-3 font-mono text-[11px] leading-5 text-ink-2">{notice}</p> : null}{error ? <p role="alert" className="mt-4 border-l-2 border-[color:var(--err)] p-3 font-mono text-[11px] leading-5 text-ink-2">{error}</p> : null}</BracketedCell>
        </section>
        {run ? <section className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-accent">TEST RESULT</div><h2 className="mt-2 font-stencil text-4xl uppercase leading-none sm:text-5xl">THE AGENT ANSWERED</h2></div><span className="font-mono text-[10px] uppercase tracking-[.12em] text-ink-3">{run.durationMs} MS / SCORE {run.score}</span></div><div className="grid gap-5 lg:grid-cols-2"><BracketedCell pad="lg"><pre className="max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-6 text-ink-2">{JSON.stringify(run.output, null, 2)}</pre><details className="mt-5 border-t border-[color:var(--hairline)] pt-4 font-mono text-[10px] text-ink-3"><summary className="cursor-pointer uppercase tracking-[.12em] text-ink">TECHNICAL EVIDENCE</summary><div className="mt-4 grid gap-2"><HashRow label="EVIDENCE ROOT" value={run.evidence.evidenceRoot} /><HashRow label="RESPONSE HASH" value={run.evidence.responseHash} /><HashRow label="TASK COMMITMENT" value={run.evidence.taskCommitment} /><HashRow label="BLOCK" value={run.provenance.blockNumber ?? "local"} /></div></details></BracketedCell><ArenaAnchor run={run} selectedListing={selectedListing} address={address} isPending={isPending} onRequest={() => void requestEvaluation()} /></div></section> : null}
        <section className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6"><div className="border-l-2 border-accent pl-4 font-mono text-[11px] leading-[1.65] text-ink-2">Running a challenge does not move funds or write to the network. Requesting an official verification record is a separate wallet action for the selected service version.</div><div className="mt-5 flex flex-wrap gap-3"><TagButton href="/market/new">LIST YOUR AGENT</TagButton><TagButton href="/docs/list-agents" variant="ghost">OPEN PROVIDER GUIDE</TagButton></div></section>
      </main>
    </div>
  );
}

function ArenaAnchor({ run, selectedListing, address, isPending, onRequest }: { run: AgonPlaygroundRun; selectedListing: AgonListing | null; address?: `0x${string}`; isPending: boolean; onRequest: () => void }) {
  const scopedToListing = Boolean(run.scope && selectedListing && run.scope.listingReference === selectedListing.id && run.scope.listingVersion === selectedListing.version);
  return <BracketedCell pad="lg"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-accent">OFFICIAL RECORD</div><h3 className="mt-3 font-stencil text-3xl uppercase leading-none">REQUEST VERIFICATION</h3><p className="mt-4 font-mono text-[11px] leading-5 text-ink-2">{scopedToListing ? `This result is tied to Agent #${selectedListing?.agentId}, version ${selectedListing?.version}. Request an independent AGON review to add it to the service record.` : "This was a public sample. Select a listed agent above and run the challenge again to request an official record."}</p><button type="button" disabled={isPending || !address || !scopedToListing} onClick={onRequest} className="mt-5 w-full bg-accent px-3 py-3 font-mono text-[11px] uppercase tracking-[.12em] text-accent-ink disabled:opacity-50">{!address ? "CONNECT OWNER WALLET" : "REQUEST AGON VERIFICATION"}</button><p className="mt-4 font-mono text-[10px] leading-5 text-ink-3">The wallet request records the exact service version and test commitment. AGON completes scoring separately.</p></BracketedCell>;
}

function HashRow({ label, value }: { label: string; value: string }) { return <div className="grid gap-1"><span>{label}</span><span className="break-all text-ink-2">{value}</span></div>; }
function Readout({ label, value }: { label: string; value: string }) { return <div className="bg-[color:var(--card-ink-bg)] px-3 py-3"><div className="font-mono text-[9px] uppercase tracking-[.14em] text-[color:var(--card-ink-fg)]/55">{label}</div><div className="mt-1 font-mono text-[11px] text-[color:var(--card-ink-fg)]">{value}</div></div>; }
