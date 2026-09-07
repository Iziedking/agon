# AGON Market demo runbook

This runbook covers the public BNB Testnet product flow. It uses the same buyer path a new user sees: choose a goal, inspect a service, test it without payment, then hire it when the service is ready.

## Before recording

Open the BNB Testnet market:

`https://agon.surf/market?network=bnb-testnet`

Confirm the read-only runtime checks from a terminal:

```bash
curl -sS https://api.agon.surf/api/bnb/97/health
curl -sS https://agon.surf/api/bnb/97/providers/lp-guardian/erc8183/status
```

The expected live state is BNB Testnet, worker healthy, `paid_hiring: true`, and no blockers. These checks do not send a transaction.

If the marketplace list reports that the catalog is temporarily unavailable,
open the registered LP Guardian directly and continue with the same real flow:

`https://agon.surf/market/2177?network=bnb-testnet`

This fallback bypasses the catalog indexer for the demo. Do not describe it as
full category coverage until the catalog is responding again.

## The three-minute buyer story

1. Start on **Market**. Keep **BNB Testnet** selected.
2. Choose **LP rebalancing** or search for service `2177`.
3. Use **CHECK LIVE**. Point out that the check is free and sends no payment.
4. Open **AGON LP Guardian**. Show the service name, what it does, price, and BNB Testnet context.
5. Select **TRY LIVE** and run the read-only position check with a real BNB Testnet position ID.
6. Return to **USE NOW**. The page shows the four wallet steps before any transaction: start request, confirm service, approve the exact amount, and pay for the report.
7. Review every wallet request, approve the exact `0.1 U`, and fund the job only when the wallet shows the expected network and amount.
8. Return to the request page. The worker status changes from request in progress to the delivered report.
9. Open the report and show the public report link, payment receipt, delivery receipt, and job status.

## Recovery path

If the browser is refreshed, sign in with the same buyer wallet and scroll to **RECENT REQUESTS**. Select **OPEN REQUEST** to continue an existing request. The page keeps expired, paid, failed, and report-ready requests visible with their current state.

If the daily allowance is already used, do not create a second job or describe the flow as newly completed. Show the existing request and its receipts, then use the read-only live check for the rest of the recording.

## What to say

“AGON Market helps a buyer find a service by outcome, check that it responds, see the price before connecting a wallet, and review every payment step. The market never treats a listing as proof of performance. The live check and the final report are separate, visible records.”

## Do not claim

- A category is fully covered unless a real service responds on BNB.
- A provider is trusted because it is indexed.
- A job is complete before the delivery and payment receipts are visible.
- Grid trading or health-factor monitoring is available until a real responding provider is onboarded for that goal.

## Final capture checklist

- BNB Testnet is visible in the network selector.
- The agent name and plain-language service description are visible before technical details.
- The live check result is visible and says no payment was sent.
- The exact price and wallet steps are visible before approval.
- The final report and both receipt links are visible if a paid run completed.
- The recording does not show private keys, passwords, environment files, or terminal secrets.
