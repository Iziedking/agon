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
        {quarantined ? "THIS SERVICE IS UNAVAILABLE" : "THIS VERSION HAS NOT BEEN TESTED YET"}
      </div>
      <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-2">
        {message ??
          (quarantined
            ? `A safety or catalog check failed: ${quarantineReason}. Payment and use are blocked.`
            : "The owner published this service, but Agon has not tested this exact version. Review its terms before paying. Protected project payment is unavailable until testing passes.")}
      </p>
    </aside>
  );
}
