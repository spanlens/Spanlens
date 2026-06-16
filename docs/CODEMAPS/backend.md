<!-- Generated: 2026-06-16 | Source: apps/server/src/{app.ts,api,lib,middleware,proxy} -->

# Backend Codemap (apps/server)

## Entrypoint

- `api/index.ts` — Vercel Node handler (custom body-buffer, see CLAUDE.md gotcha #8)
- `src/app.ts` — Hono router mount order. **mount order matters** — `/api/v1` wildcard routers (evalsRouter, humanEvalsRouter) MUST mount after specific routers, else wildcard authJwt swallows dual-auth.

## Proxy routes (write — authApiKey + requireFullScope)

```
/proxy/openai/v1/*       → src/proxy/openai.ts
/proxy/anthropic/v1/*    → src/proxy/anthropic.ts
/proxy/gemini/v1/*       → src/proxy/gemini.ts
/proxy/mistral/v1/*      → src/proxy/mistral.ts          (added PR #327)
/proxy/openrouter/v1/*   → src/proxy/openrouter.ts       (added PR #328)
/proxy/azure/v1/*        → src/proxy/azure.ts
/ingest/*                → src/api/ingest.ts             (trace/span/event)
/v1/traces (OTLP)        → src/api/otlp.ts
```

Shared proxy middleware: `src/proxy/shared/` (extracted PR #320). Stream pump: `src/proxy/stream-deadline.ts` (290s soft deadline).

## REST API (`/api/v1/*` — auth varies)

| Path | Router | Auth |
|---|---|---|
| `/me/key-info` | `api/me.ts` | authApiKey (CLI introspection) |
| `/organizations` | `api/organizations.ts` | authJwt |
| `/projects` | `api/projects.ts` | authJwt |
| `/api-keys`, `/provider-keys` | `api/{apiKeys,providerKeys}.ts` | authJwt |
| `/requests` `/stats` `/traces` `/users` `/anomalies` `/recommendations` | corresponding `api/*.ts` | **authJwtOrApiKey** (dual) |
| `/alerts` `/security` `/saved-filters` `/sessions` | `api/*.ts` | authJwt |
| `/billing` | `api/billing.ts` | authJwt |
| `/prompts` `/prompts/playground` `/prompt-experiments` | `api/prompts*.ts` | authJwt |
| `/invitations` (GET /accept public) | `api/invitations.ts` | mixed |
| `/feedback` | `api/feedback.ts` | anonymous read + authJwt write (R-32) |
| `/datasets` `/score-configs` | `api/*.ts` | authJwt |
| `/* (evals, human-evals)` wildcards | `api/evals.ts` `api/human-evals.ts` | authJwt — must mount LAST |
| `/admin/*` | `api/admin/` | authJwt + requireSystemAdmin (SPANLENS_ADMIN_EMAILS allowlist) |
| `/openapi.json` `/docs` | `api/openapi.ts` | public (Swagger UI) |

## Middleware chain

```
cors → requestId → logger → [route-specific]
   ├─ proxy/ingest/OTLP   : authApiKey → requireFullScope → quota → rateLimit
   ├─ /api/v1 read (dual) : apiRateLimit → authJwtOrApiKey
   ├─ /api/v1 read (jwt)  : apiRateLimit → authJwt
   └─ /cron/*             : Bearer CRON_SECRET check
```

## Cron jobs (15 schedules, dispatch in `api/cron.ts`)

Per-job code in `src/lib/cron-jobs/`:
- `evaluate-alerts.ts` (15m) — threshold + anomaly alerts → email/Slack/Discord
- `aggregate-usage.ts` — daily usage aggregation
- `detect-missing-model-prices.ts` (hourly) — catch new model IDs in CH not in `model_prices`
- `detect-orphan-spans.ts` (hourly :17) — spans whose parent trace never arrived
- `self-monitor.ts` (hourly :31) — dogfood heartbeat eval
- `keep-warm.ts` (5m) — Vercel function warm
- `prune-judge-cache.ts` (daily 03:00) — judge cache TTL evict
- (`snapshot-anomalies`, `stale-key-reminders`, `leak-detect-keys`, `recommend-savings-alerts`, `replay-fallback`, `check-past-due-downgrades`, `execute-pending-deletions`, `run-background-migrations`, `events-reconciliation` — colocated)

## Core libs (do not reimplement)

- `lib/crypto.ts` — AES-256-GCM, all async (gotcha #12 — never skip `await`)
- `lib/cost.ts` — `calculateCost(provider, model, usage)` sync, exact + longest-prefix model match
- `lib/model-prices-cache.ts` — SWR price cache (5m TTL, FALLBACK_PRICES cold-start safety)
- `lib/logger.ts` — `logRequestAsync` + `parseLogBodyMode`
- `lib/wait-until.ts` — `fireAndForget(c, promise)` — Vercel Edge/Node-safe (gotcha #8)
- `lib/clickhouse.ts` — singleton + `toClickhouseTimestamp()` (gotcha #18)
- `lib/requests-query.ts` — `requestsScope` + `selectRequests` (auto org+retention filter, gotcha #3)
- `lib/stats-queries.ts` — CH SQL for `/stats/*` (replaced old Postgres RPCs)
- `lib/anomaly.ts` — anomaly detection (CH inline SQL)
- `lib/pii-mask.ts` — secret/key masking on bodies
- `lib/fallback-replay.ts` — drain `requests_fallback` → CH
- `lib/eval-runners/` — judge / deterministic / embedding / trajectory / agreement (Cohen's κ, Pearson r) / judge-cache
- `lib/cron-jobs/` — cron handler bodies (extracted PR #319)
- `lib/cron-logger.ts` — `logCronRun` (must `await` — gotcha #8)
- `lib/admin-emails.ts` — SPANLENS_ADMIN_EMAILS allowlist

## Parsers (provider-specific stream chunk → usage)

- `parsers/openai.ts` — usage in final chunk
- `parsers/anthropic.ts` — usage in `message_delta` (different shape!)
- `parsers/gemini.ts`

## Tests

- `__tests__/` + colocated `*.test.ts` (Vitest)
- Integration: `__tests__/proxy.integration.test.ts` (PR #316)
