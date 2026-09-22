import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type AgonAlertSeverity = "info" | "warning" | "critical";
export type AgonAlertSource = "certification" | "arena";
export type AgonAlertStatus = "open" | "acknowledged" | "resolved";

export type AgonOperationsAlert = {
  alertId: string;
  operator: string;
  fingerprint: string;
  source: AgonAlertSource;
  severity: AgonAlertSeverity;
  status: AgonAlertStatus;
  title: string;
  body: string | null;
  href: string | null;
  context: Record<string, unknown>;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
};

export type RaiseAgonOperationsAlert = {
  operator: string;
  fingerprint: string;
  source: AgonAlertSource;
  severity: AgonAlertSeverity;
  title: string;
  body?: string;
  href?: string;
  context?: Record<string, unknown>;
  resolved?: boolean;
};

export type AgonOperationsAlertSink = {
  raise(input: RaiseAgonOperationsAlert): Promise<AgonOperationsAlert>;
  resolve(operator: string, fingerprint: string): Promise<boolean>;
};

export type AgonOperationsAlertDeliveryRepository = {
  claimDelivery(now?: Date): Promise<AgonAlertDelivery | null>;
  completeDelivery(deliveryId: string, providerMessageId?: string | null): Promise<void>;
  deferDelivery(deliveryId: string, error: string, input: { increment: boolean; nextAttemptAt: Date }): Promise<void>;
};

type AlertRow = {
  alert_id: string;
  operator: string;
  fingerprint: string;
  source: AgonAlertSource;
  severity: AgonAlertSeverity;
  status: AgonAlertStatus;
  title: string;
  body: string | null;
  href: string | null;
  context: Record<string, unknown> | null;
  occurrence_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  resolved_at: Date | null;
  notification_id: string | null;
};

export type AgonAlertDelivery = {
  delivery_id: string;
  alert_id: string;
  operator: string;
  chat_id: string | null;
  title: string;
  body: string | null;
  href: string | null;
  severity: AgonAlertSeverity;
  attempts: number;
  max_attempts: number;
};

function normalizeOperator(value: string): string {
  const address = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("operations alert operator must be an address");
  return address;
}

function toAlert(row: AlertRow): AgonOperationsAlert {
  return {
    alertId: row.alert_id,
    operator: row.operator,
    fingerprint: row.fingerprint,
    source: row.source,
    severity: row.severity,
    status: row.status,
    title: row.title,
    body: row.body,
    href: row.href,
    context: row.context ?? {},
    occurrenceCount: Number(row.occurrence_count),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    resolvedAt: row.resolved_at,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("rollback").catch(() => undefined);
}

/** Canonical incident repository. The notification bell and Telegram outbox are projections of this record. */
export class PostgresAgonOperationsAlertRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async raise(input: RaiseAgonOperationsAlert): Promise<AgonOperationsAlert> {
    const operator = normalizeOperator(input.operator);
    const fingerprint = input.fingerprint.trim().slice(0, 256);
    if (!fingerprint) throw new Error("operations alert fingerprint is required");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const status: AgonAlertStatus = input.resolved ? "resolved" : "open";
      const inserted = await client.query<AlertRow>(
        `insert into agon_operations_alerts
           (alert_id, operator, fingerprint, source, severity, status, title, body, href, context,
            occurrence_count, first_seen_at, last_seen_at, resolved_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,now(),now(),case when $6 = 'resolved' then now() else null end)
         on conflict (operator, fingerprint) where status = 'open'
         do update set
           severity = case
             when excluded.severity = 'critical' then 'critical'
             when excluded.severity = 'warning' and agon_operations_alerts.severity = 'info' then 'warning'
             else agon_operations_alerts.severity
           end,
           title = excluded.title,
           body = excluded.body,
           href = excluded.href,
           context = excluded.context,
           occurrence_count = agon_operations_alerts.occurrence_count + 1,
           last_seen_at = now(),
           updated_at = now()
         returning *`,
        [
          randomUUID(), operator, fingerprint, input.source, input.severity, status,
          input.title.slice(0, 180), input.body?.slice(0, 2000) ?? null,
          input.href?.slice(0, 1024) ?? null, JSON.stringify(input.context ?? {}),
        ],
      );
      let row = inserted.rows[0]!;
      if (!row.notification_id) {
        const notification = await client.query<{ id: string }>(
          `insert into notifications (operator, kind, title, body, href, context)
           values ($1,$2,$3,$4,$5,$6) returning id::text`,
          [
            operator,
            input.source === "arena" ? "arena_review_escalation" : "agon_service_lifecycle",
            row.title,
            row.body,
            row.href,
            JSON.stringify({ ...row.context, operationsAlertId: row.alert_id, severity: row.severity }),
          ],
        );
        const notificationId = notification.rows[0]!.id;
        const updated = await client.query<AlertRow>(
          "update agon_operations_alerts set notification_id = $2 where alert_id = $1 returning *",
          [row.alert_id, notificationId],
        );
        row = updated.rows[0]!;
        await client.query(
          `insert into agon_alert_delivery_outbox
             (delivery_id, alert_id, channel, status, attempts, max_attempts, next_attempt_at)
           values ($1,$2,'telegram','pending',0,8,now())
           on conflict (alert_id, channel) do nothing`,
          [randomUUID(), row.alert_id],
        );
      } else {
        await client.query(
          `update notifications
              set title = $2, body = $3, href = $4,
                  context = $5
            where id = $1`,
          [
            row.notification_id,
            row.title,
            row.body,
            row.href,
            JSON.stringify({ ...row.context, operationsAlertId: row.alert_id, severity: row.severity }),
          ],
        );
        await client.query(
          `update agon_alert_delivery_outbox
              set status = 'pending', attempts = 0, next_attempt_at = now(),
                  lease_expires_at = null, last_error = null, updated_at = now()
            where alert_id = $1 and channel = 'telegram' and status = 'delivered'
              and case delivered_severity when 'critical' then 3 when 'warning' then 2 else 1 end
                  < case $2 when 'critical' then 3 when 'warning' then 2 else 1 end`,
          [row.alert_id, row.severity],
        );
      }
      await client.query("commit");
      return toAlert(row);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async resolve(operator: string, fingerprint: string): Promise<boolean> {
    const result = await this.pool.query(
      `update agon_operations_alerts
          set status = 'resolved', resolved_at = now(), updated_at = now()
        where operator = $1 and fingerprint = $2 and status = 'open' and severity <> 'critical'`,
      [normalizeOperator(operator), fingerprint],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async acknowledge(alertId: string, acknowledgedBy: string): Promise<AgonOperationsAlert | null> {
    const result = await this.pool.query<AlertRow>(
      `update agon_operations_alerts
          set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $2, updated_at = now()
        where alert_id = $1 and status = 'open'
        returning *`,
      [alertId, acknowledgedBy.slice(0, 160)],
    );
    return result.rows[0] ? toAlert(result.rows[0]) : null;
  }

  async list(limit = 100): Promise<AgonOperationsAlert[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const result = await this.pool.query<AlertRow>(
      `select * from agon_operations_alerts
        order by case status when 'open' then 0 when 'acknowledged' then 1 else 2 end,
                 case severity when 'critical' then 0 when 'warning' then 1 else 2 end,
                 last_seen_at desc
        limit $1`,
      [safeLimit],
    );
    return result.rows.map(toAlert);
  }

  async claimDelivery(now = new Date()): Promise<AgonAlertDelivery | null> {
    const result = await this.pool.query<AgonAlertDelivery>(
      `with claimed as (
         select delivery_id
           from agon_alert_delivery_outbox
          where status in ('pending','retry','processing')
            and next_attempt_at <= $1
            and (lease_expires_at is null or lease_expires_at <= $1)
          order by next_attempt_at, created_at
          for update skip locked
          limit 1
       ), updated as (
         update agon_alert_delivery_outbox d
            set status = 'processing', lease_expires_at = $1 + interval '60 seconds', updated_at = $1
           from claimed
          where d.delivery_id = claimed.delivery_id
          returning d.*
       )
       select u.delivery_id, u.alert_id, a.operator, o.telegram_id as chat_id,
              a.title, a.body, a.href, a.severity, u.attempts, u.max_attempts
         from updated u
         join agon_operations_alerts a on a.alert_id = u.alert_id
         left join operators o on lower(o.address) = a.operator`,
      [now],
    );
    return result.rows[0] ?? null;
  }

  async completeDelivery(deliveryId: string, providerMessageId?: string | null): Promise<void> {
    await this.pool.query(
      `update agon_alert_delivery_outbox d
          set status = 'delivered', delivered_at = now(), provider_message_id = $2,
              delivered_severity = a.severity,
              lease_expires_at = null, last_error = null, updated_at = now()
         from agon_operations_alerts a
        where d.delivery_id = $1 and a.alert_id = d.alert_id`,
      [deliveryId, providerMessageId ?? null],
    );
  }

  async deferDelivery(deliveryId: string, error: string, input: { increment: boolean; nextAttemptAt: Date }): Promise<void> {
    await this.pool.query(
      `update agon_alert_delivery_outbox
          set attempts = attempts + case when $3 then 1 else 0 end,
              status = case when $3 and attempts + 1 >= max_attempts then 'dead' else 'retry' end,
              next_attempt_at = $2, lease_expires_at = null, last_error = $4, updated_at = now()
        where delivery_id = $1`,
      [deliveryId, input.nextAttemptAt, input.increment, error.slice(0, 1000)],
    );
  }

  async readiness(input: { operator?: string; enabled: boolean; workerEnabled: boolean; telegramConfigured: boolean }) {
    const operator = input.operator ? normalizeOperator(input.operator) : null;
    const recipient = operator
      ? await this.pool.query<{ exists: boolean; telegram_linked: boolean }>(
          `select exists(select 1 from operators where lower(address) = $1) as exists,
                  exists(select 1 from operators where lower(address) = $1 and telegram_id is not null) as telegram_linked`,
          [operator],
        )
      : { rows: [{ exists: false, telegram_linked: false }] };
    const delivery = await this.pool.query<{ pending: string; retrying: string; dead: string }>(
      `select count(*) filter (where status in ('pending','processing'))::text as pending,
              count(*) filter (where status = 'retry')::text as retrying,
              count(*) filter (where status = 'dead')::text as dead
         from agon_alert_delivery_outbox`,
    );
    const recipientExists = recipient.rows[0]?.exists === true;
    const telegramLinked = recipient.rows[0]?.telegram_linked === true;
    const reasons: string[] = [];
    if (!input.enabled) reasons.push("alerts_disabled");
    if (!operator) reasons.push("recipient_unconfigured");
    if (operator && !recipientExists) reasons.push("recipient_not_found");
    if (operator && recipientExists && !telegramLinked) reasons.push("telegram_not_linked");
    if (!input.telegramConfigured) reasons.push("telegram_bot_unconfigured");
    if (!input.workerEnabled) reasons.push("delivery_worker_disabled");
    return {
      enabled: input.enabled,
      ready: reasons.length === 0,
      recipientAddress: operator,
      recipientExists,
      telegramLinked,
      workerEnabled: input.workerEnabled,
      pendingDeliveries: Number(delivery.rows[0]?.pending ?? 0),
      retryingDeliveries: Number(delivery.rows[0]?.retrying ?? 0),
      deadDeliveries: Number(delivery.rows[0]?.dead ?? 0),
      reasons,
      checkedAt: new Date().toISOString(),
    };
  }
}

export type TelegramAlertSender = (input: { chatId: string; text: string }) => Promise<string | null>;

export function createTelegramAlertSender(input: { botToken?: string; appUrl: string; fetchImpl?: typeof fetch }): TelegramAlertSender {
  const fetchImpl = input.fetchImpl ?? fetch;
  return async ({ chatId, text }) => {
    if (!input.botToken) throw new Error("telegram bot is not configured");
    const response = await fetchImpl(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!response.ok) throw new Error(`telegram_http_${response.status}`);
    const body = await response.json().catch(() => null) as { result?: { message_id?: number } } | null;
    return body?.result?.message_id ? String(body.result.message_id) : null;
  };
}

export async function deliverAgonOperationsAlertOnce(input: {
  repository: AgonOperationsAlertDeliveryRepository;
  sendTelegram: TelegramAlertSender;
  appUrl: string;
  now?: () => Date;
  retryBaseMs?: number;
}): Promise<"idle" | "delivered" | "deferred" | "failed"> {
  const now = input.now?.() ?? new Date();
  const delivery = await input.repository.claimDelivery(now);
  if (!delivery) return "idle";
  if (!delivery.chat_id) {
    await input.repository.deferDelivery(delivery.delivery_id, "recipient_telegram_not_linked", {
      increment: false,
      nextAttemptAt: new Date(now.getTime() + 15 * 60_000),
    });
    return "deferred";
  }
  const link = delivery.href ? `${input.appUrl.replace(/\/$/, "")}${delivery.href}` : null;
  const text = [`[${delivery.severity.toUpperCase()}] ${delivery.title}`, delivery.body, link].filter(Boolean).join("\n");
  try {
    const messageId = await input.sendTelegram({ chatId: delivery.chat_id, text });
    await input.repository.completeDelivery(delivery.delivery_id, messageId);
    return "delivered";
  } catch (error) {
    const attempts = delivery.attempts + 1;
    const retryBase = input.retryBaseMs ?? 30_000;
    const delay = Math.min(60 * 60_000, retryBase * 2 ** Math.min(8, Math.max(0, attempts - 1)));
    await input.repository.deferDelivery(delivery.delivery_id, error instanceof Error ? error.message : "telegram_delivery_failed", {
      increment: true,
      nextAttemptAt: new Date(now.getTime() + delay),
    });
    return attempts >= delivery.max_attempts ? "failed" : "deferred";
  }
}

export async function agonOperationsAlertWorkerLoop(input: {
  repository: AgonOperationsAlertDeliveryRepository;
  sendTelegram: TelegramAlertSender;
  appUrl: string;
  retryBaseMs?: number;
}, control: { once?: boolean; pollMs?: number } = {}): Promise<void> {
  do {
    const result = await deliverAgonOperationsAlertOnce(input);
    if (control.once) return;
    await new Promise((resolve) => setTimeout(resolve, result === "idle" ? control.pollMs ?? 5_000 : 100));
  } while (true);
}
