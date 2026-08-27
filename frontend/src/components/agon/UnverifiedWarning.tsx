type Props = {
  message?: string | null;
  quarantineReason?: string | null;
};

function customerMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "missing_validated_version":
      return "This service record is still being checked. Try again shortly.";
    case "manifest_hash_mismatch":
      return "The published service file no longer matches this service record.";
    case "provider_snapshot_mismatch":
      return "The service owner changed before this service record was confirmed.";
    default:
      return "Agon could not confirm this service record. Use another service for now.";
  }
}

export function UnverifiedWarning({ message, quarantineReason }: Props) {
  const quarantined = Boolean(quarantineReason);
  const visibleMessage = quarantined
    ? `${customerMessage(quarantineReason)} Payment and use are blocked.`
    : message ?? "The owner published this service, but Agon has not tested this exact version. Review its terms before paying. Protected project payment is unavailable until testing passes.";
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
        {visibleMessage}
      </p>
    </aside>
  );
}
