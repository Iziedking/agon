## AGON BNB Market (hackathon subtree)

Standalone Next.js frontend for the BNB Market build.

### Local

```bash
npm install
npm run typecheck
npm run dev -- --hostname 127.0.0.1 --port 3004
```

If `next dev` cannot start in this environment due `EPERM`, use the same
commands on a local machine with a normal shell.

### Structure

- `src/app/page.tsx` – discovery landing
- `src/app/market/page.tsx` – filtered browse
- `src/app/market/[id]/page.tsx` – service detail
- `src/app/market/new/page.tsx` – list/adapt entry flow
- `src/lib/bnb/*` – chain and catalog layers
- `src/components/bnb/*` – market UI primitives
- `BUILD_PLAN.md` – execution plan and coding constraints
