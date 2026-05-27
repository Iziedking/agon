/// A 6×6px square in the status color + mono caps label. The square is the
/// only colored mark; the label stays ink. Never on a colored pill
/// background. Never rounded.

type Tone = "ok" | "warn" | "err" | "accent" | "ink";

const TONE_VAR: Record<Tone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
  accent: "var(--accent)",
  ink: "var(--ink)",
};

const MARK: Record<"dot" | "square", string> = {
  dot: "●",
  square: "■",
};

interface Props {
  tone?: Tone;
  mark?: "dot" | "square";
  children: React.ReactNode;
}

export function StatusChip({ tone = "ok", mark = "dot", children }: Props) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
      <span aria-hidden style={{ color: TONE_VAR[tone] }}>{MARK[mark]}</span>
      <span>{children}</span>
    </span>
  );
}
