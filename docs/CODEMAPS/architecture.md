<!-- Generated: 2026-06-19 | Source: app.ts + vercel.json + monorepo layout -->

# Architecture Codemap

## System layout

```
Client (LLM SDK)
   │ POST /proxy/{provider}/v1/*  (Bearer sl_live_*)
   ▼
apps/server (Hono, Vercel Node runtime, maxDuration 300s)
   │ authApiKey → requireFullScope → fetch upstream → body.tee() → passthrough
   │                                                              ↘ logRequestAsync (fire-and-forget via waitUntil)
   ▼                                                                ▼
Provider (OpenAI / Anthropic / Gemini / Mistral / OpenRouter / Azure)
                                                                 ClickHouse `requests`
                                                                  ↑ fallback queue (Supabase) if CH down
                                                                    drained by /cron/replay-fallback (every 5m)

apps/web (Next.js 16, App Router)
   │ fetch('/api/v1/*')  (Supabase JWT or sl_live_*)
   ▼
apps/server REST API → Supabase (orgs/keys/prompts/billing) + ClickHouse (read via lib/requests-query)
```

## Service boundaries

| Service | Runtime | Storage | Auth |
|---|---|---|---|
| `apps/web` | Next.js 16 / Vercel | none (proxies to server) | Supabase JWT cookies |
| `apps/server` | Hono / Vercel Node | Supabase + ClickHouse + Upstash KV | JWT (read) / sl_live_* (write) / dual-auth (`/api/v1/*` read) |
| `packages/sdk` | npm `@spanlens/sdk` | — | issues sl_live_* requests |
| `packages/sdk-python` | PyPI `spanlens` | — | issues sl_live_* requests |
| `packages/cli` | npx `@spanlens/cli init` | rewrites `.env.local` | OAuth-less, paste-key |
| `packages/mcp-server` | npx `@spanlens/mcp-server` | — | sl_live_pub_* (public scope only) |

## Dependency direction (do not violate)

- `apps/web → apps/server` via fetch only (no direct import)
- `apps/server → supabase/clickhouse`
- `packages/sdk → external only` (never imports `apps/`)

## Data flow — proxy hot path

1. SDK swaps `baseURL` → `/proxy/{provider}/v1/*`
2. `middleware/authApiKey.ts`: validate sl_live_* → set `organizationId`, `projectId`, `scope`
3. `middleware/requireFullScope.ts`: reject sl_live_pub_* on write paths (403)
4. `middleware/quota.ts` + `middleware/rateLimit.ts` (Upstash sliding window)
5. `proxy/{provider}.ts`: decrypt provider key (`lib/crypto.ts`) → fetch upstream
6. Stream: `body.tee()` → one copy to client, one to `proxy/stream-deadline.ts` (290s graceful close → `truncated:true`)
7. `lib/wait-until.ts` `fireAndForget()` → `lib/logger.ts` `logRequestAsync` → ClickHouse INSERT or `requests_fallback` queue

## Background jobs (15 crons)

Cron router (`api/cron.ts`) dispatches by path. Per-job logic in `lib/cron-jobs/`. Triple-scheduler (Vercel + GH Actions + Better Stack) — see CLAUDE.md gotcha #32.

## Key files

- `apps/server/src/app.ts` — router mount order (read CLAUDE.md "인증 계층" before editing)
- `apps/server/api/index.ts` — Node runtime entrypoint (custom body-buffer handler, do not replace with `hono/vercel` or `@hono/node-server` — see gotcha #8)
- `apps/server/vercel.json` — cron schedule + maxDuration 300s
- `apps/web/middleware.ts` — workspace scope, onboarding redirect, JWT refresh
