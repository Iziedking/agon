import type { VerificationStatus } from "@/lib/agon/types";

const STYLES: Record<VerificationStatus, string> = {
  Verified: "border-[color:var(--ok)] text-ink",
  Pending: "border-[color:var(--warn)] text-ink",
  Unverified: "border-[color:var(--hairline-strong)] text-ink-2",
  Expired: "border-[color:var(--warn)] text-ink-2",
  Suspended: "border-[color:var(--err)] text-[color:var(--err)]",
  Revoked: "border-[color:var(--err)] text-[color:var(--err)]",
};

const LABELS: Record<VerificationStatus, string> = {
  Verified: "Verified",
  Pending: "Verification pending",
  Unverified: "Provider listed",
  Expired: "Verification expired",
  Suspended: "Verification suspended",
  Revoked: "Verification revoked",
};

export function VerificationBadge({ status, quarantined = false }: { status: VerificationStatus; quarantined?: boolean }) {
  const style = quarantined ? "border-[color:var(--err)] text-[color:var(--err)]" : STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-2 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${style}`}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5"
        style={{
          background:
            quarantined
              ? "var(--err)"
              : status === "Verified"
              ? "var(--ok)"
              : status === "Pending" || status === "Expired"
                ? "var(--warn)"
                : status === "Suspended" || status === "Revoked"
                  ? "var(--err)"
                  : "var(--ink-3)",
        }}
      />
      {quarantined ? "Quarantined" : LABELS[status]}
    </span>
  );
}
