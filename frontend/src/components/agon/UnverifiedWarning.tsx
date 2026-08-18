type Props = {
  message?: string | null;
  quarantineReason?: string | null;
};

export function UnverifiedWarning({ message, quarantineReason }: Props) {
  const quarantined = Boolean(quarantineReason);
  return (
    <aside
      className="border-l-[3px] bg-canvas-2 px-4 py-3"
      style={{ borderColor: quarantined ? "var(--err)" : "var(--warn)" }}
      role="note"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink">
        {quarantined ? "DO NOT USE THIS SERVICE" : "PROVIDER-LISTED SERVICE"}
      </div>
      <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-2">
        {message ??
          (quarantined
            ? `The catalog isolated this record after a failed check: ${quarantineReason}. Payment and execution must remain blocked.`
            : "Agon has not verified this exact service version. Review the service terms before direct x402 payment. Escrow remains unavailable.")}
      </p>
    </aside>
  );
}
