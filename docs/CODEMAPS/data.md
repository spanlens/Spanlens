<!-- Generated: 2026-06-19 | Source: supabase/{init.sql,migrations} + clickhouse/migrations -->

# Data Codemap

## Storage split

| Concern | Store | Why |
|---|---|---|
| Orgs, projects, keys, prompts, billing, evals, alerts | **Supabase Postgres** | relational, RLS, transactional |
| `requests` (every LLM call) | **ClickHouse** | high-volume append-only, columnar agg |
| Rate-limit buckets | **Upstash Redis** | sub-ms, ephemeral |
| Fallback queue when CH down | Supabase `requests_fallback` | durable buffer, drained by cron |

## Supabase tables (~40, RLS-gated)

```
Identity / multi-tenant
  organizations, org_members, org_invitations, user_profiles, user_notification_prefs

Projects / keys
  projects, api_keys (scope: full | public), provider_keys, rate_limit_buckets

LLM ops
  requests_fallback (Postgres-only CH backstop), traces, spans
  model_prices (seeded), recommendation_applications, recommendation_notifications

Prompts / evals / experiments
  prompt_versions, prompt_ab_experiments
  evaluators, eval_runs, eval_results, judge_cache
  human_evals, score_configs
  datasets, dataset_items, experiments, experiment_results

Alerts / anomalies / security
  alerts, alert_deliveries, notification_channels
  anomaly_events, anomaly_acks, anomaly_snapshots
  webhooks, webhook_deliveries, internal_alerts

Billing
  subscriptions, subscription_overage_charges, usage_daily

Audit / housekeeping
  audit_logs, attn_dismissals, saved_filters, cron_job_runs
  pending_deletions, background_migrations, provider_key_leak_scans
  feedback, feedback_votes (R-32)
  user_consents (append-only ToS/Privacy/DPA acceptance log — IP+UA from server)
  waitlist
```

**Key constraints:**
- `api_keys.scope` CHECK in (`'full'`, `'public'`) + `api_keys_scope_owner_consistency` (scope/project_id/organization_id triple)
- `provider_keys.api_key_id` NOT NULL (nested under api_key) — UNIQUE (api_key_id, provider) where active=true
- `spans.parent_span_id` — no FK (intentional, parallel agent spans)
- `org_members` RLS — never self-reference in USING clause (42P17 infinite recursion, gotcha #14)

## ClickHouse tables

```
clickhouse/migrations/
  001_create_requests.sql           — main log table (DateTime64, Decimal cost, JSON fields)
  002_add_truncated.sql             — stream graceful-close flag (P2.2)
  003_add_service_tier.sql
  004_create_events.sql             — generalized events (R-12)
  005_create_events_as_requests_view.sql
  006_add_events_security_columns.sql
  007_rebuild_events_as_requests_view.sql
  008_create_trace_and_span_views.sql
```

**All reads go through `apps/server/src/lib/requests-query.ts`** — auto-injects `organization_id` + plan retention (free=14d / pro=90d / team=365d). Direct `getClickhouse().query()` allowed only in lib files with explicit org filter.

**Pitfalls** (see CLAUDE.md gotchas #3, #18-21, #23):
- DateTime64 wants `2026-05-16 11:49:23.749` not ISO (no `T`, no `Z`) — use `toClickhouseTimestamp()`
- JSONEachRow returns all numerics as strings — `Number()` cast at API boundary
- No `ilike` — use `positionCaseInsensitive(col, 'x') > 0`
- `input_format_skip_unknown_fields=1` is on — protects deploy-before-migration but masks column typos
- INSERT failure → `requests_fallback` Supabase queue → `/cron/replay-fallback` drains every 5m

## Migration history

- Supabase: **122 migrations** since `20260420000000_initial_schema.sql`
- ClickHouse: **8 migrations** since `001_create_requests.sql`
- Both immutable once applied. Recovery for broken Supabase migrations: fake-apply in `supabase_migrations.schema_migrations` + new timestamped `*_v2.sql` (CLAUDE.md "Broken migration 복구 절차"). Same broken file also `rm -f`'d in `.github/workflows/ci.yml` to keep CI green.
- ClickHouse migrations idempotent only (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) — never DROP.

## Seeds

- `supabase/seeds/model_prices.sql` — provider price table (rerun via migration when refreshed, e.g. PR #335 added 170 OpenRouter + Anthropic 4.8 + Fable + Mythos)
- `supabase/seeds/dummy_traces.sql` — local-dev fixtures
- `supabase/init.sql` — flattened schema for self-host one-click apply (regenerated via `pnpm db:generate-init`)

## Type generation

```
supabase gen types --lang typescript --local 2>/dev/null > supabase/types.ts
```

Always pipe stderr to /dev/null (CLI leaks warnings onto stdout → breaks tsc).
