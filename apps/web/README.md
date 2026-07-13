# apps/web — Spanlens dashboard

Next.js 16 (App Router) frontend for [Spanlens](https://spanlens.io): the dashboard at `www.spanlens.io`, the marketing pages, and the docs at `/docs`.

This package never talks to Supabase for data — all reads and writes go through the Hono server (`apps/server`) via `fetch('/api/v1/...')`. The only Supabase usage here is auth/session plumbing (middleware, login callback).

## Develop

From the **repo root** (pnpm workspace — do not use npm or yarn):

```bash
cp apps/server/.env.example apps/server/.env   # server env (see root README)
cp apps/web/.env.example apps/web/.env.local   # web env
pnpm install
pnpm dev        # web on :3000, server on :3001
```

The dashboard is useless without the server running; `pnpm dev` at the root starts both.

## Verify changes

```bash
pnpm --filter web typecheck
pnpm --filter web lint
```

## Conventions

- Tailwind only — no inline styles.
- Server components fetch data; client components own interaction (`useState`, `onClick`).
- SSR-rendered dates go through `lib/utils.ts` (`formatDate` / `formatDateTime` / `formatTime`) — locale-free `toLocaleString()` causes hydration mismatches.
- See the root [CLAUDE.md](../../CLAUDE.md) for the full convention list and known gotchas.

## Deploy

Deployed to Vercel via git integration on pushes to `main` (project `spanlens-web`). No manual step.
