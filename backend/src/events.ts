import { query } from "./db/pool.js";

export type EventLevel = "info" | "warn" | "error";

export interface EventInput {
  level?: EventLevel;
  kind: string;
  message?: string;
  context?: unknown;
  address?: string;
  source?: string;
}

/// Append one row to the activity log. Never throws into the caller: logging
/// must not break the thing it is observing.
export async function logEvent(e: EventInput): Promise<void> {
  try {
    let ctx: string | null = null;
    if (e.context !== undefined && e.context !== null) {
      let s = JSON.stringify(e.context);
      if (s.length > 8000) s = JSON.stringify({ truncated: true, preview: s.slice(0, 2000) });
      ctx = s;
    }
    await query(
      `insert into events (level, kind, message, context, address, source)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        e.level ?? "info",
        e.kind.slice(0, 64),
        e.message ? e.message.slice(0, 2000) : null,
        ctx,
        e.address ? e.address.slice(0, 64) : null,
        e.source ?? "server",
      ],
    );
  } catch (err) {
    console.error("logEvent failed:", err);
  }
}
