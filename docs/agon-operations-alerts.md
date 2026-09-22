# AGON operations alerts

AGON uses one durable incident system for continuous certification and Arena exceptions. An alert is created only after the product state transition or reconciliation result has been stored. Notification delivery can fail without changing a listing's certification or Arena state.

## Incident lifecycle

- `info`: recovery or informational event. Recovery records are stored as resolved history.
- `warning`: a service check needs attention but has not reached the suspension threshold.
- `critical`: an exceptional condition that needs an administrator. It remains open until an authenticated administrator acknowledges it.
- Repeated failures with the same operator and fingerprint update the existing open incident and increment `occurrenceCount`.
- A warning that becomes critical reuses the incident and sends one new Telegram escalation.
- A successful certification recheck resolves its open warning. It cannot auto-resolve an Arena critical incident.

The `agon_operations_alerts` row is canonical. Recipient-specific in-app notifications and `agon_alert_delivery_outbox` rows all reference that incident. Telegram retries use a leased durable outbox with bounded exponential backoff, so an auth-service restart does not lose delivery work.

## Recipient and authentication

`AGON_OPERATIONS_ALERT_OPERATOR_ADDRESS` identifies the fallback escalation owner. It always receives platform incidents through in-app and Telegram delivery. During migration it falls back to `AGON_CERTIFICATION_ALERT_OPERATOR_ADDRESS`.

Additional recipients are stored in `agon_alert_subscriptions`. A provider may subscribe only to an indexed listing whose `provider_snapshot` matches the authenticated wallet. Administrators may add platform or service subscriptions for additional AGON staff. Severity and channel preferences are evaluated before delivery fan-out, while every recipient still points to the same canonical incident.

Every Telegram recipient must:

1. exist in the `operators` table;
2. link Telegram through the normal authenticated account flow;
3. enable Telegram on a service or platform subscription, unless it is the configured fallback recipient.

Provider subscription endpoints use the normal wallet session:

- `GET /agon/alert-subscriptions`
- `POST /agon/alert-subscriptions`
- `DELETE /agon/alert-subscriptions/:subscriptionId`

The provider workspace exposes these controls after sign-in. Platform-wide subscriptions remain behind `POST /admin/agon/alert-subscriptions` and the existing admin token.

Public health exposes only readiness booleans, counts, reason codes, and the configured wallet address. It never returns a Telegram ID or bot token.

Alert history and acknowledgement use the existing admin token boundary:

- `GET /admin/agon/alerts`
- `POST /admin/agon/alerts/:alertId/acknowledge`

The AGON operator console shows open incidents first and keeps acknowledged or resolved history in a collapsed section. Provider and buyer users do not need the admin console.

## Configuration

```ini
AGON_OPERATIONS_ALERTS_ENABLED=true
AGON_OPERATIONS_ALERT_WORKER_ENABLED=true
AGON_OPERATIONS_ALERT_OPERATOR_ADDRESS=0x0000000000000000000000000000000000000000
AGON_OPERATIONS_ALERT_RETRY_BASE_SECONDS=30
```

The existing Telegram bot configuration must also be present. Do not put bot tokens, Telegram IDs, or private keys in logs or health output.

## Release check

After migration and restart:

1. Read `/agon/health` and confirm `capabilities.operationsAlerts.ready` is `true`.
2. Confirm `recipientExists`, `telegramLinked`, and `workerEnabled` are `true`.
3. Trigger one controlled warning and verify one incident appears in-app and one Telegram message is delivered.
4. Add a provider subscription, trigger one warning, and verify both recipients see projections of the same incident ID.
5. Trigger the identical warning again and verify the occurrence count increases without a second delivery.
6. Escalate it to critical and verify one new Telegram escalation is delivered to each eligible recipient.
7. Stop Telegram delivery temporarily, raise an alert, restart delivery, and confirm the queued items are delivered.
8. Acknowledge a critical incident through the admin console and verify its status changes to `acknowledged` for every projection.
9. Confirm certification and Arena state are identical whether Telegram succeeds or fails.
