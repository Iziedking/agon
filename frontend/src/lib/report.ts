const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export type ReportLevel = "info" | "warn" | "error";

/// Fire-and-forget activity and error report to the backend log. Never throws,
/// never blocks the user. The user sees a friendly message; the raw detail goes
/// here for the admin.
export function reportEvent(
  kind: string,
  opts: { level?: ReportLevel; message?: string; context?: unknown; address?: string } = {},
): void {
  try {
    void fetch(`${AUTH_URL}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...opts }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // logging must never break the app
  }
}
