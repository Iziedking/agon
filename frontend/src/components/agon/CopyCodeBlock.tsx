"use client";

import { useState } from "react";

export function CopyCodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative border border-[color:var(--hairline-strong)] bg-canvas-2">
      <button
        type="button"
        className="absolute right-2 top-2 min-h-11 border border-[color:var(--hairline-strong)] px-3 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
        onClick={() => { void copy(); }}
      >
        {copied ? "COPIED" : "COPY"}
      </button>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words p-5 pr-24 font-mono text-[11px] leading-[1.75] text-ink-2"><code>{code}</code></pre>
    </div>
  );
}
