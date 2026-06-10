import { config } from "../config/index.js";
import { query } from "../db/pool.js";

/// Operator-targeted notifications. Each call writes a row the frontend feed
/// reads, and relays the same line to Telegram when the operator has linked
/// it. The frontend polls the feed and plays a sound on new unread items, so
/// no per-operator WebSocket channel is needed. Global events (a new contest
/// opening) ride the existing live WebSocket instead of this path.

export type NotificationKind =
  | "contest_win"
  | "challenge_win"
  | "challenge_invite"
  | "balance_credit"
  | "balance_debit"
  | "training_done"
  | "mystery_win"
  | "custom_request";

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  context?: Record<string, unknown>;
}

/// Insert a notification for one operator and relay to Telegram if linked.
/// Best-effort: failures are logged, never thrown, so a notification can
/// never break the path that triggered it.
export async function notify(operator: string, input: NotifyInput): Promise<void> {
  const addr = operator.toLowerCase();
  try {
    await query(
      `insert into notifications (operator, kind, title, body, href, context)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        addr,
        input.kind,
        input.title,
        input.body ?? null,
        input.href ?? null,
        input.context ? JSON.stringify(input.context) : null,
      ],
    );
  } catch (err) {
    console.warn(`[notify] insert failed: ${err instanceof Error ? err.message : err}`);
  }
  void relayTelegram(addr, input);
}

/// Send the notification to the operator's linked Telegram chat. No-op when
/// the bot isn't configured or the operator hasn't linked Telegram.
async function relayTelegram(operator: string, input: NotifyInput): Promise<void> {
  const token = config.auth.telegram.botToken;
  if (!token) return;
  try {
    const { rows } = await query<{ telegram_id: string | null }>(
      "select telegram_id from operators where address = $1",
      [operator],
    );
    const chatId = rows[0]?.telegram_id;
    if (!chatId) return;

    const text = input.body ? `${input.title}\n${input.body}` : input.title;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.warn(`[notify] telegram relay HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[notify] telegram relay failed: ${err instanceof Error ? err.message : err}`);
  }
}

/// Notify several operators at once (e.g. every winner of a settled contest).
export async function notifyMany(operators: string[], input: NotifyInput): Promise<void> {
  const seen = new Set<string>();
  for (const op of operators) {
    const addr = op.toLowerCase();
    if (seen.has(addr)) continue;
    seen.add(addr);
    await notify(addr, input);
  }
}
