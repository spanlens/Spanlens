<!-- Generated: 2026-06-16 | Source: apps/{server,web}/package.json + vercel.json -->

# Dependencies Codemap

## External services

| Service | Purpose | Env var | Failure mode |
|---|---|---|---|
| **Supabase** | Postgres + Auth + Storage | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*` | hard fail — required |
| **ClickHouse** | `requests` log | `CLICKHOUSE_URL/USER/PASSWORD/DB` | fallback queue (Supabase) drained by `/cron/replay-fallback` |
| **Upstash Redis** | rate limiting (sliding window) | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | fails open (allow all) |
| **Resend** | transactional email (invites, alerts) | `RESEND_API_KEY`, `RESEND_FROM`, `WEB_URL` | logs URL to console (dev) / silent skip |
| **Paddle** | billing (MoR) | `PADDLE_API_KEY`, `PADDLE_NOTIFICATION_SECRET`, `PADDLE_ENVIRONMENT` | billing disabled — proxy still works |
| **GitGuardian** | provider-key leak scan | `GITGUARDIAN_API_KEY` | cron no-op |
| **Sentry** | error monitoring | `SENTRY_DSN/ORG/PROJECT/AUTH_TOKEN` | silent skip |
| **OpenAI/Anthropic/Gemini/Mistral/OpenRouter/Azure** | LLM upstream | provider keys (encrypted in `provider_keys`) | per-request failure surfaced to caller |

## Infrastructure

- **Vercel** — hosts `apps/web` (Next.js) + `apps/server` (Hono Node, maxDuration 300s, region `icn1`)
- **GitHub Actions** — CI (typecheck/lint/test/CodeQL), Docker publish (GHCR), GH cron mirror
- **Better Stack** — uptime monitor (3rd cron-firing safety net, see CLAUDE.md gotcha #32)
- **ClickHouse Cloud Development tier** ($50/mo) for prod logs

## NPM dependencies (apps/server)

```
hono 4.12          — HTTP router
@clickhouse/client 1.20
@supabase/supabase-js 2.107
@upstash/ratelimit 2 + @upstash/redis 1.38
@vercel/functions 3.6  — waitUntil (fireAndForget — gotcha #8)
@sentry/node + @sentry/profiling-node 10
ajv 8              — JSON schema validation (OpenAPI drift test)
dotenv 17
```

## NPM dependencies (apps/web)

```
next 16.2.7        — App Router
react 19 + react-dom 19
@supabase/ssr 0.10
@tanstack/react-query 5.101
@radix-ui/*        — primitives (dialog, dropdown, tabs, etc.)
@xyflow/react 12   — trace graph topology view
recharts 3.8       — charts (wrap with dynamic-ssr, gotcha #22-D)
lucide-react       — icons
@paddle/paddle-js 1.6 — checkout overlay
cmdk 1             — command palette
geist 1            — font
tailwindcss 4 + @tailwindcss/typography
```

## Published packages

| Package | Registry | Purpose |
|---|---|---|
| `@spanlens/sdk` | npm | TS/JS SDK (createOpenAI, observe*, callback handlers) |
| `spanlens` | PyPI | Python SDK |
| `@spanlens/cli` | npm | `npx @spanlens/cli init` setup wizard |
| `@spanlens/mcp-server` | npm + MCP Registry | 7 tools for Cursor/Claude Desktop/Continue (sl_live_pub_* only) |
| `@spanlens/api-types` | workspace internal | shared types between web ↔ server |
| `@spanlens/eslint-plugin` | workspace internal | error-envelope lint rules |

## Internal workspace links

```
apps/web → @spanlens/api-types, server (devDep, for E2E)
apps/server → @spanlens/api-types
packages/cli → @spanlens/sdk
packages/mcp-server → (none — talks to server.spanlens.io REST API)
```

## Build / CI

- **pnpm** 10.33 (workspace via `pnpm-workspace.yaml`)
- **lefthook** pre-commit (rejects edits to merged Supabase migrations, off-pattern filenames)
- **CodeQL** for security scanning
- Vercel auto-deploy on `main` push (server: migrate-then-deploy via `.github/workflows/deploy-server.yml`, web: Vercel git integration)

## Env-var groupings (see apps/server/.env.example)

Required: `SUPABASE_*`, `ENCRYPTION_KEY`, `CLICKHOUSE_*`
Recommended: `CRON_SECRET`, `WEB_URL`, `RESEND_API_KEY`
Optional: Paddle, Sentry, Upstash, GitGuardian, `SPANLENS_INTERNAL_*` (self-dogfood), `SPANLENS_ADMIN_EMAILS`
