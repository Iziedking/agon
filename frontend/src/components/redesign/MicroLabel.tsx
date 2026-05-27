/// Small mono-caps eyebrow label with a pink square marker. The chaingpt
/// "instrument panel" tag. Use above stat bands and section headings to
/// add density without clutter.
export function MicroLabel({
  children,
  tone = "ink",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "ink" | "ink-3";
  className?: string;
}) {
  const text = tone === "ink-3" ? "text-ink-3" : "text-ink";
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] ${text} ${className}`}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 bg-accent" />
      {children}
    </span>
  );
}

/// 01 — 02 — 03 numeric counter strip. Drop above a 2/3/4-column tile band
/// to label each tile with its index. Items are mono-caps with a hairline
/// rule connecting them.
export function CounterStrip({ count }: { count: number }) {
  return (
    <div aria-hidden className="flex items-center gap-2">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="flex flex-1 items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
            {String(i + 1).padStart(2, "0")}
          </span>
          {i < count - 1 ? (
            <span className="h-px flex-1 bg-[color:var(--hairline-strong)]" />
          ) : null}
        </span>
      ))}
    </div>
  );
}
