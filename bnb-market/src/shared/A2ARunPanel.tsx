"use client";

import { useEffect, useState } from "react";
import { readAgentA2A, runAgentA2A } from "./client";
import type { BnbChain } from "./types";
import type { A2ACapability, A2ARun } from "./providers/a2a-core";

const PANEL = "min-w-0 border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6";
const BUTTON = "inline-flex min-h-11 items-center justify-center border border-[color:var(--hairline-strong)] px-4 py-3 font-mono text-xs uppercase tracking-wide text-ink hover:bg-canvas-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const PRIMARY = `${BUTTON} bg-accent !text-accent-ink`;
const LABEL = "font-mono text-[11px] uppercase tracking-wide text-ink-2";
const BODY = "font-sans text-sm leading-relaxed text-ink-2";

const STATE_LABEL: Record<A2ARun["state"], string> = {
  completed: "Agent completed the task",
  input_required: "Agent needs more detail",
  failed: "Agent declined the task",
  unknown: "Agent responded",
};

function failureText(value: unknown) {
  return value instanceof Error ? value.message : "The run could not be completed. Please retry.";
}

/** Pretty-print a JSON artifact so a buyer can read it, but never reformat
 * the provider's words or merge separate artifacts into one claim. */
function Artifact({ value }: { value: string }) {
  let display = value;
  try { display = JSON.stringify(JSON.parse(value), null, 2); } catch { /* plain text is fine */ }
  return <pre className="mt-3 max-h-80 overflow-auto border border-[color:var(--hairline)] bg-canvas p-4 font-mono text-xs leading-relaxed text-ink [overflow-wrap:anywhere] whitespace-pre-wrap">{display}</pre>;
}

export function A2ARunPanel({ chainId, agentId }: { chainId: BnbChain; agentId: string }) {
  const [capability, setCapability] = useState<A2ACapability | null>(null);
  const [unavailable, setUnavailable] = useState("");
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<A2ARun | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setCapability(null); setUnavailable(""); setLoading(true); setRun(null); setError(""); setText("");
    readAgentA2A(chainId, agentId, controller.signal)
      .then((value) => { if (!controller.signal.aborted) { setCapability(value); setLoading(false); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setUnavailable(failureText(cause)); setLoading(false); } });
    return () => controller.abort();
  }, [chainId, agentId]);

  async function start() {
    setBusy(true); setError(""); setRun(null);
    try { setRun(await runAgentA2A(chainId, agentId, text)); }
    catch (cause) { setError(failureText(cause)); }
    finally { setBusy(false); }
  }

  if (loading) return <section className={PANEL}><p role="status" className={BODY}>Reading this agent's declared capability...</p></section>;

  if (!capability) {
    return <section className={PANEL} aria-labelledby="a2a-unavailable">
      <p className={LABEL}>Free run</p>
      <h3 id="a2a-unavailable" className="mt-2 font-stencil text-2xl uppercase">Free run unavailable</h3>
      <p className={`${BODY} mt-3`}>{unavailable}</p>
      <p className={`${BODY} mt-3`}>Nothing was sent and no payment was requested. This says AGON could not reach a runnable endpoint for this identity right now, not that the provider is untrustworthy.</p>
    </section>;
  }

  return <section className={PANEL} aria-labelledby="a2a-heading">
    <p className={LABEL}>Free run · no payment</p>
    <h3 id="a2a-heading" className="mt-2 font-stencil text-2xl uppercase">Run this agent now</h3>
    <p className={`${BODY} mt-3 max-w-[80ch]`}>
      This sends your request straight to the endpoint the provider registered onchain, over A2A
      {capability.protocolVersion ? ` ${capability.protocolVersion}` : ""}. It is free, it moves no funds, and it grants no authority over anything you own.
    </p>

    <h4 className={`${LABEL} mt-6`}>What this agent says it can do</h4>
    <ul className="mt-3 space-y-3">
      {capability.skills.map((skill) => <li key={skill.id} className="border-l-2 border-[color:var(--hairline-strong)] pl-4">
        <p className="font-mono text-xs uppercase tracking-wide text-ink">{skill.name}</p>
        {skill.description ? <p className={`${BODY} mt-1`}>{skill.description}</p> : null}
        <button type="button" className={`${BUTTON} mt-3`} onClick={() => setText(skill.description ? `${skill.name}. ${skill.description}` : skill.name)}>Use as starting point →</button>
      </li>)}
    </ul>
    <p className={`${LABEL} mt-3`}>Declared by the provider, not verified by AGON.</p>

    <div className="mt-6">
      <label className={LABEL} htmlFor="a2a-task">Describe your task</label>
      <textarea id="a2a-task" rows={4} value={text} maxLength={1200}
        onChange={(event) => setText(event.target.value)}
        placeholder="State the address, size, asset or target the agent needs. Most agents refuse rather than guess."
        className="mt-2 w-full border border-[color:var(--hairline-strong)] bg-canvas p-3 font-mono text-xs leading-relaxed text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"/>
      <p className={`${BODY} mt-2`}>Public request. Do not include anything private.</p>
      <button className={`${PRIMARY} mt-4`} disabled={busy || !text.trim()} onClick={start}>{busy ? "Running…" : "Run free →"}</button>
    </div>

    {error ? <div role="alert" className="mt-6 border-l-2 border-[color:var(--err)] pl-4">
      <p className={`${BODY} !text-ink`}>{error}</p>
      <p className={`${BODY} mt-2`}>No payment was sent. Retry, or adjust the request.</p>
    </div> : null}

    {run ? <div className="mt-6 border-t border-[color:var(--hairline)] pt-6" role="status">
      <p className={LABEL}>{STATE_LABEL[run.state]} · {run.durationMs} ms</p>
      <p className={`${BODY} mt-2`}>{run.message}</p>
      {run.artifacts.map((artifact, index) => <Artifact key={index} value={artifact} />)}
      <dl className="mt-5 grid gap-4 border-t border-[color:var(--hairline)] pt-5 sm:grid-cols-2">
        <div><dt className={LABEL}>Answered at</dt><dd className="mt-1 text-sm text-ink">{new Date(run.requestedAt).toLocaleString()}</dd></div>
        <div><dt className={LABEL}>Chain height stated</dt><dd className="mt-1 text-sm text-ink">{run.blockNumber ?? "Not stated by the agent"}</dd></div>
        <div className="sm:col-span-2"><dt className={LABEL}>Endpoint</dt><dd className="mt-1 break-all font-mono text-xs text-ink">{run.endpoint}</dd></div>
      </dl>
      <p className={`${BODY} mt-4`}>
        This is the provider's own answer to a free request. It is not an AGON verification, not a
        performance record, and no payment or settlement took place.
      </p>
    </div> : null}
  </section>;
}
