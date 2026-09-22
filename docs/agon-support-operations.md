# AGON support workspace

AGON support keeps customer help separate from protocol administration. Staff use named email and password accounts at `/support/admin/login`. Their session can read and update support tickets only. It cannot access the operator console, wallets, payment execution, verification writes, or contract controls.

## Surfaces

- `/support`: customer conversation with the AGON guide and the shared support team.
- `/support/admin/login`: staff sign-in and required first-password change.
- `/support/admin`: shared queue, full conversation history, assignment, priority, public replies, internal notes, and resolution status.
- `/support/admin/setup`: owner-only staff provisioning. The owner enters `ADMIN_TOKEN` in memory, creates a temporary password, and shares it privately.

The existing `/admin` console remains a separate high-privilege surface. Giving someone a support account does not give them general admin access. If a teammate truly needs the operator console, the owner handles that separately through the existing admin-token process.

## Access and recovery

1. Apply the database migration before starting the updated auth service.
2. Open `/support/admin/setup` and enter the owner `ADMIN_TOKEN`.
3. Create a named support or technical-support account with a temporary password.
4. The teammate signs in at `/support/admin/login` and must replace the temporary password.
5. Disable a departed or compromised account from the setup page. Disabling an account revokes its active sessions.

Passwords are stored as salted scrypt hashes. Staff sessions are opaque, hashed in the database, sent in an HttpOnly cookie, and expire after 12 hours. Five incorrect password attempts lock a known account for 15 minutes. A durable rate limit also bounds login and ticket-creation attempts without storing raw IP addresses or emails in the rate-limit key.

## Ticket continuity

Every customer message, AI answer, staff reply, and internal note is stored in one ticket timeline. Any signed-in teammate can open the same ticket and continue from the recorded conversation. Claiming an unassigned ticket is atomic; a second teammate cannot silently replace the assignee. Internal notes never appear in the customer view.

The customer receives a random ticket access token once. The browser keeps it in `sessionStorage`; the database stores only its SHA-256 hash. Losing the browser session currently means the customer cannot reopen that anonymous ticket without team help. Email delivery and account-bound ticket recovery are deliberately not claimed by this version.

## AI guide

The deterministic support guide works without a model key and covers common listing, icon, wallet, payment, hiring, playground, and verification steps. Sensitive or account-specific cases move to the human queue. The guide never changes payment, verification, listing, or wallet state.

Model assistance is opt-in:

```ini
AGON_SUPPORT_AI_ENABLED=true
AGON_SUPPORT_AI_DAILY_USD=2
AGON_SUPPORT_AI_MODEL=claude-haiku-4-5-20251001
```

At least one existing LLM provider must also be configured. The support cap is checked independently of the global LLM kill switch. When the feature is disabled, unconfigured, over budget, or unavailable, the deterministic guide remains available. Model prompts redact private keys, long bearer tokens, wallet addresses, and explicitly labelled secrets. The server also redacts those patterns before storing customer messages.

Check readiness without exposing secrets:

```bash
curl -fsS https://api.agon.surf/support/health | jq .
```

## Deploy and rollback

Run the migration before replacing the auth service. Back up Postgres before the migration because ticket and staff records are operational data. The new tables are additive and do not change contract, wallet, listing, Arena, or x402 state.

For rollback, disable model assistance, return the frontend to the previous image, and keep the new tables intact. Removing tables would destroy ticket history and is not part of rollback.

## Current limits

- Staff account creation and disable are available; email invitations are not sent automatically.
- Customers start support with a name and email, but this version does not verify ownership of that email.
- Ticket access is browser-session based until authenticated ticket recovery is added.
- Support AI uses public guidance only and cannot inspect private account state.
