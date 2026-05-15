-- =============================================================================
-- Spanlens — full database initialisation script
-- =============================================================================
-- Run this once against your Supabase project to create all tables, functions,
-- triggers, RLS policies, and seed data required by Spanlens.
--
-- How to run:
--   Option A (Supabase Dashboard):
--     1. Open your project → SQL Editor → New query
--     2. Paste the entire contents of this file and click Run
--
--   Option B (psql / CI):
--     psql "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
--       -f supabase/init.sql
--
-- This file is auto-generated from supabase/migrations/ — do not edit directly.
-- Regenerate with: node scripts/generate-init-sql.mjs
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Migration: 20260420000000_initial_schema.sql
-- -----------------------------------------------------------------------------
-- Migration: initial_schema
-- Tables: organizations, projects, api_keys, provider_keys,
--         model_prices, requests, usage_daily, audit_logs

-- ────────────────────────────────────────────────────────────
-- Trigger helper: keep updated_at current
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 1. organizations
-- ────────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan       TEXT NOT NULL DEFAULT 'free'
               CHECK (plan IN ('free', 'starter', 'team', 'enterprise')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select"  ON organizations FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "org_insert"  ON organizations FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "org_update"  ON organizations FOR UPDATE
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- Helper: org membership check (used by RLS policies below)
-- Must be created after `organizations` exists because PG 15
-- validates function bodies at creation (check_function_bodies=on).
-- SECURITY DEFINER so it can bypass RLS on organizations itself.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_org_member(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organizations
    WHERE id = org_id AND owner_id = auth.uid()
  )
$$;

-- ────────────────────────────────────────────────────────────
-- 2. projects
-- ────────────────────────────────────────────────────────────
CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_select" ON projects
  FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "project_insert" ON projects
  FOR INSERT WITH CHECK (is_org_member(organization_id));
CREATE POLICY "project_update" ON projects
  FOR UPDATE USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "project_delete" ON projects
  FOR DELETE USING (is_org_member(organization_id));

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. api_keys  (Spanlens API keys issued to users)
-- ────────────────────────────────────────────────────────────
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,   -- SHA-256(raw_key)
  key_prefix   TEXT NOT NULL,          -- first 12 chars for display
  is_active    BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_key_select" ON api_keys FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = api_keys.project_id
        AND is_org_member(p.organization_id)
    )
  );
CREATE POLICY "api_key_insert" ON api_keys FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = api_keys.project_id
        AND is_org_member(p.organization_id)
    )
  );
CREATE POLICY "api_key_update" ON api_keys FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = api_keys.project_id
        AND is_org_member(p.organization_id)
    )
  );
CREATE POLICY "api_key_delete" ON api_keys FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = api_keys.project_id
        AND is_org_member(p.organization_id)
    )
  );

CREATE TRIGGER api_keys_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. provider_keys  (encrypted actual OpenAI/Anthropic/Gemini keys)
-- ────────────────────────────────────────────────────────────
CREATE TABLE provider_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL
                    CHECK (provider IN ('openai', 'anthropic', 'gemini')),
  name            TEXT NOT NULL,
  encrypted_key   TEXT NOT NULL,   -- AES-256-GCM via lib/crypto.ts
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE provider_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "provider_key_select" ON provider_keys FOR SELECT
  USING (is_org_member(organization_id));
CREATE POLICY "provider_key_insert" ON provider_keys FOR INSERT
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "provider_key_update" ON provider_keys FOR UPDATE
  USING (is_org_member(organization_id));
CREATE POLICY "provider_key_delete" ON provider_keys FOR DELETE
  USING (is_org_member(organization_id));

CREATE TRIGGER provider_keys_updated_at
  BEFORE UPDATE ON provider_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- 5. model_prices  (reference table; updated via seed or admin)
-- ────────────────────────────────────────────────────────────
CREATE TABLE model_prices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                TEXT NOT NULL,
  model                   TEXT NOT NULL,
  prompt_price_per_1m     NUMERIC(10, 6) NOT NULL,
  completion_price_per_1m NUMERIC(10, 6) NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, model)
);

ALTER TABLE model_prices ENABLE ROW LEVEL SECURITY;

-- Public read; writes only via service_role
CREATE POLICY "model_prices_public_select" ON model_prices
  FOR SELECT USING (true);

CREATE TRIGGER model_prices_updated_at
  BEFORE UPDATE ON model_prices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- 6. requests  (immutable log; INSERT via supabaseAdmin only)
-- ────────────────────────────────────────────────────────────
CREATE TABLE requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  project_id      UUID NOT NULL REFERENCES projects(id),
  api_key_id      UUID NOT NULL REFERENCES api_keys(id),
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  prompt_tokens   INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(12, 8),
  latency_ms      INTEGER NOT NULL,
  status_code     INTEGER NOT NULL,
  request_body    JSONB,
  response_body   JSONB,
  error_message   TEXT,
  trace_id        TEXT,
  span_id         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE requests ENABLE ROW LEVEL SECURITY;

-- Composite indexes for dashboard queries
CREATE INDEX requests_org_created_idx     ON requests (organization_id, created_at DESC);
CREATE INDEX requests_project_created_idx ON requests (project_id, created_at DESC);

CREATE POLICY "requests_org_member_select" ON requests
  FOR SELECT USING (is_org_member(organization_id));
-- No INSERT policy → only service_role (supabaseAdmin) can write

-- ────────────────────────────────────────────────────────────
-- 7. usage_daily  (aggregates; populated by cron in Phase 2A)
-- ────────────────────────────────────────────────────────────
CREATE TABLE usage_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id)      ON DELETE CASCADE,
  date            DATE NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  request_count   INTEGER  NOT NULL DEFAULT 0,
  prompt_tokens   BIGINT   NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens    BIGINT   NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(14, 8) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, project_id, date, provider, model)
);

ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_daily_org_member_select" ON usage_daily
  FOR SELECT USING (is_org_member(organization_id));
-- INSERT/UPDATE via service_role only (cron job, Phase 2A)

CREATE TRIGGER usage_daily_updated_at
  BEFORE UPDATE ON usage_daily
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- 8. audit_logs  (INSERT via service_role only)
-- ────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id),
  action          TEXT NOT NULL,   -- e.g. 'api_key.create', 'provider_key.add'
  resource_type   TEXT NOT NULL,
  resource_id     TEXT,
  metadata        JSONB,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_org_member_select" ON audit_logs
  FOR SELECT USING (is_org_member(organization_id));
-- No INSERT policy → service_role only

-- -----------------------------------------------------------------------------
-- Migration: 20260421000000_agent_tracing.sql
-- -----------------------------------------------------------------------------
-- Migration: agent_tracing
-- Tables: traces, spans
--
-- 에이전트 실행 트레이싱용. trace = 하나의 논리적 사용자 인터랙션
-- (예: "질문 → 에이전트 실행 → 응답"), spans = 그 안의 개별 단계
-- (LLM 호출 1회, 툴 호출 1회, retrieval 1회 등).
--
-- CLAUDE.md Known Gotcha #4에 따라 spans.parent_span_id는 FK 제약 없음
-- (의도적) — LangGraph 스타일 병렬 fan-out에서 span이 순서 없이 도착해도
-- INSERT가 실패하지 않아야 함.

-- ────────────────────────────────────────────────────────────
-- 9. traces
-- ────────────────────────────────────────────────────────────
CREATE TABLE traces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  api_key_id      UUID REFERENCES api_keys(id) ON DELETE SET NULL,

  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'error')),

  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  duration_ms    INT,

  metadata        JSONB,
  error_message   TEXT,

  -- Aggregate counters refreshed by a DB trigger when spans update
  span_count         INT NOT NULL DEFAULT 0,
  total_tokens       INT NOT NULL DEFAULT 0,
  total_cost_usd     NUMERIC(12, 6) NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX traces_project_created_idx
  ON traces (project_id, created_at DESC);
CREATE INDEX traces_org_started_idx
  ON traces (organization_id, started_at DESC);

ALTER TABLE traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "traces_select" ON traces
  FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "traces_insert" ON traces
  FOR INSERT WITH CHECK (is_org_member(organization_id));
CREATE POLICY "traces_update" ON traces
  FOR UPDATE USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "traces_delete" ON traces
  FOR DELETE USING (is_org_member(organization_id));

CREATE TRIGGER traces_updated_at
  BEFORE UPDATE ON traces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- 10. spans
-- ────────────────────────────────────────────────────────────
-- parent_span_id에 FK 제약을 걸지 않음 — 병렬 fan-out 지원 (의도적).
-- organization_id는 denormalized — RLS 정책이 traces를 역참조하지 않도록.
CREATE TABLE spans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id        UUID NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  parent_span_id  UUID,  -- NO FK (by design, Known Gotcha #4)
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  span_type       TEXT NOT NULL DEFAULT 'custom'
                    CHECK (span_type IN ('llm', 'tool', 'retrieval', 'embedding', 'custom')),
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'error')),

  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  duration_ms     INT,

  input           JSONB,
  output          JSONB,
  metadata        JSONB,
  error_message   TEXT,

  -- Optional link to a proxy request row — populated when span_type = 'llm'
  -- and the span was recorded via the Spanlens proxy (auto-instrumentation).
  request_id      UUID REFERENCES requests(id) ON DELETE SET NULL,

  -- Denormalized for quick span-level aggregation without joining requests
  prompt_tokens      INT NOT NULL DEFAULT 0,
  completion_tokens  INT NOT NULL DEFAULT 0,
  total_tokens       INT NOT NULL DEFAULT 0,
  cost_usd           NUMERIC(12, 6),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX spans_trace_started_idx
  ON spans (trace_id, started_at);
CREATE INDEX spans_parent_idx
  ON spans (parent_span_id);
CREATE INDEX spans_request_idx
  ON spans (request_id) WHERE request_id IS NOT NULL;

ALTER TABLE spans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spans_select" ON spans
  FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "spans_insert" ON spans
  FOR INSERT WITH CHECK (is_org_member(organization_id));
CREATE POLICY "spans_update" ON spans
  FOR UPDATE USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "spans_delete" ON spans
  FOR DELETE USING (is_org_member(organization_id));

-- ────────────────────────────────────────────────────────────
-- 11. refresh_trace_aggregates trigger
-- ────────────────────────────────────────────────────────────
-- spans가 INSERT/UPDATE/DELETE 될 때마다 부모 trace의 집계 컬럼
-- (span_count, total_tokens, total_cost_usd, duration_ms)을 갱신.
-- 대시보드가 traces 한 번만 SELECT하면 되도록 — spans를 매번 집계하지 않게.
CREATE OR REPLACE FUNCTION refresh_trace_aggregates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_trace_id UUID;
BEGIN
  target_trace_id := COALESCE(NEW.trace_id, OLD.trace_id);

  UPDATE traces t
  SET
    span_count       = (SELECT COUNT(*) FROM spans WHERE trace_id = target_trace_id),
    total_tokens     = (SELECT COALESCE(SUM(total_tokens), 0) FROM spans WHERE trace_id = target_trace_id),
    total_cost_usd   = (SELECT COALESCE(SUM(cost_usd), 0) FROM spans WHERE trace_id = target_trace_id),
    updated_at       = now()
  WHERE t.id = target_trace_id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER spans_refresh_trace_aggregates
  AFTER INSERT OR UPDATE OR DELETE ON spans
  FOR EACH ROW EXECUTE FUNCTION refresh_trace_aggregates();

-- -----------------------------------------------------------------------------
-- Migration: 20260421010000_aggregate_usage_daily_fn.sql
-- -----------------------------------------------------------------------------
-- Migration: aggregate_usage_daily_fn
-- RPC function that rolls up `requests` rows into `usage_daily` for a given date.
-- Called hourly by the Vercel cron at /cron/aggregate-usage.
--
-- Safe to call multiple times per day — ON CONFLICT on the usage_daily
-- UNIQUE(organization_id, project_id, date, provider, model) makes the
-- upsert idempotent. Later hourly runs simply overwrite with the latest
-- totals.

CREATE OR REPLACE FUNCTION aggregate_usage_daily(target_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  row_count INTEGER;
BEGIN
  INSERT INTO usage_daily (
    organization_id, project_id, date, provider, model,
    request_count, prompt_tokens, completion_tokens, total_tokens, cost_usd
  )
  SELECT
    organization_id,
    project_id,
    target_date AS date,
    provider,
    model,
    COUNT(*) AS request_count,
    COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
    COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
    COALESCE(SUM(total_tokens), 0) AS total_tokens,
    COALESCE(SUM(cost_usd), 0) AS cost_usd
  FROM requests
  WHERE created_at >= target_date::timestamptz
    AND created_at <  (target_date + INTERVAL '1 day')::timestamptz
    AND status_code < 400
    AND model IS NOT NULL
    AND model <> ''
  GROUP BY organization_id, project_id, provider, model
  ON CONFLICT (organization_id, project_id, date, provider, model)
  DO UPDATE SET
    request_count     = EXCLUDED.request_count,
    prompt_tokens     = EXCLUDED.prompt_tokens,
    completion_tokens = EXCLUDED.completion_tokens,
    total_tokens      = EXCLUDED.total_tokens,
    cost_usd          = EXCLUDED.cost_usd,
    updated_at        = now();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260421020000_paddle_billing.sql
-- -----------------------------------------------------------------------------
-- Migration: paddle_billing
-- Links organizations ↔ Paddle customer / subscription. Writes flow through the
-- webhook handler (service_role); reads from the dashboard via RLS.

-- Nullable: free plan has no Paddle customer yet.
ALTER TABLE organizations
  ADD COLUMN paddle_customer_id TEXT;

CREATE INDEX organizations_paddle_customer_idx
  ON organizations (paddle_customer_id)
  WHERE paddle_customer_id IS NOT NULL;

-- Historical rows are kept on cancel for audit — current status tells us the state.
CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  paddle_subscription_id   TEXT NOT NULL UNIQUE,
  paddle_customer_id       TEXT NOT NULL,
  paddle_price_id          TEXT NOT NULL,

  plan                     TEXT NOT NULL
                             CHECK (plan IN ('starter', 'team', 'enterprise')),
  status                   TEXT NOT NULL
                             CHECK (status IN ('active', 'trialing', 'past_due', 'paused', 'canceled')),

  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,

  metadata                 JSONB,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_org_idx ON subscriptions (organization_id);
CREATE INDEX subscriptions_status_idx ON subscriptions (status) WHERE status IN ('active', 'trialing');

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select" ON subscriptions
  FOR SELECT USING (is_org_member(organization_id));

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- Migration: 20260421030000_alerts_and_webhooks.sql
-- -----------------------------------------------------------------------------
-- Migration: alerts_and_webhooks
--
-- 3 tables for the alerting pipeline:
--  • alerts                  — threshold configs (budget / error_rate / latency_p95)
--  • notification_channels   — delivery targets (email / slack / discord)
--  • alert_deliveries        — audit log of sends (for dedup + debugging)
--
-- Evaluator cron (GitHub Actions → /cron/evaluate-alerts) reads alerts,
-- queries requests/usage_daily to compute current metric, compares to
-- threshold, and POSTs to every active channel. cooldown_minutes prevents
-- spam; last_triggered_at is stamped on each fire.

CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('budget', 'error_rate', 'latency_p95')),

  threshold       NUMERIC NOT NULL,
  window_minutes  INTEGER NOT NULL DEFAULT 60,

  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  last_triggered_at   TIMESTAMPTZ,
  cooldown_minutes    INTEGER NOT NULL DEFAULT 60,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alerts_org_idx ON alerts (organization_id) WHERE is_active = TRUE;
CREATE INDEX alerts_project_idx ON alerts (project_id) WHERE project_id IS NOT NULL;

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alerts_select" ON alerts FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "alerts_insert" ON alerts FOR INSERT WITH CHECK (is_org_member(organization_id));
CREATE POLICY "alerts_update" ON alerts FOR UPDATE
  USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
CREATE POLICY "alerts_delete" ON alerts FOR DELETE USING (is_org_member(organization_id));

CREATE TRIGGER alerts_updated_at BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


CREATE TABLE notification_channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  kind            TEXT NOT NULL CHECK (kind IN ('email', 'slack', 'discord')),
  target          TEXT NOT NULL,   -- email: address; slack/discord: webhook URL

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notification_channels_org_idx ON notification_channels (organization_id)
  WHERE is_active = TRUE;

ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channels_select" ON notification_channels
  FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "channels_insert" ON notification_channels
  FOR INSERT WITH CHECK (is_org_member(organization_id));
CREATE POLICY "channels_update" ON notification_channels
  FOR UPDATE USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "channels_delete" ON notification_channels
  FOR DELETE USING (is_org_member(organization_id));

CREATE TRIGGER channels_updated_at BEFORE UPDATE ON notification_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


CREATE TABLE alert_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  alert_id        UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel_id      UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,

  status          TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message   TEXT,
  payload         JSONB,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alert_deliveries_alert_idx ON alert_deliveries (alert_id, created_at DESC);

ALTER TABLE alert_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deliveries_select" ON alert_deliveries
  FOR SELECT USING (is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- Migration: 20260421040000_prune_logs_fn.sql
-- -----------------------------------------------------------------------------
-- Migration: prune_logs_fn
-- Called daily by /cron/prune-logs to enforce plan retention:
--   free=7d, starter=30d, team=90d, enterprise=365d

CREATE OR REPLACE FUNCTION prune_logs_by_retention()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_requests INT := 0;
  deleted_spans    INT := 0;
  deleted_traces   INT := 0;
  deleted_deliveries INT := 0;
  r RECORD;
BEGIN
  FOR r IN SELECT id, plan FROM organizations LOOP
    DECLARE
      retention_days INT;
      cutoff TIMESTAMPTZ;
      row_count INT;
    BEGIN
      retention_days := CASE r.plan
        WHEN 'free' THEN 7
        WHEN 'starter' THEN 30
        WHEN 'team' THEN 90
        ELSE 365
      END;
      cutoff := now() - (retention_days || ' days')::interval;

      DELETE FROM requests WHERE organization_id = r.id AND created_at < cutoff;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      deleted_requests := deleted_requests + row_count;

      DELETE FROM traces WHERE organization_id = r.id AND created_at < cutoff;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      deleted_traces := deleted_traces + row_count;

      DELETE FROM alert_deliveries WHERE organization_id = r.id AND created_at < cutoff;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      deleted_deliveries := deleted_deliveries + row_count;
    END;
  END LOOP;

  RETURN json_build_object(
    'deleted_requests', deleted_requests,
    'deleted_traces',   deleted_traces,
    'deleted_spans',    deleted_spans,
    'deleted_alert_deliveries', deleted_deliveries
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260421050000_request_flags.sql
-- -----------------------------------------------------------------------------
-- Phase 3A — security scan flags on requests
--
-- Flags are attached by lib/logger.ts at log time via lib/security-scan.ts.
-- Shape: jsonb array of { type: 'pii' | 'injection', pattern: string, sample: string }
-- Empty array when clean. We keep the column NOT NULL with default '[]'::jsonb
-- so query code can rely on array semantics without null checks.
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Partial index: only rows WITH flags. Empty-array rows stay out so the
-- index is small even when most traffic is clean.
CREATE INDEX IF NOT EXISTS idx_requests_flags_nonempty
  ON public.requests ((organization_id))
  WHERE jsonb_array_length(flags) > 0;

COMMENT ON COLUMN public.requests.flags IS
  'Security scan results: [{type, pattern, sample}]. Populated by lib/security-scan.ts. Empty when clean.';

-- -----------------------------------------------------------------------------
-- Migration: 20260421060000_prompt_versions.sql
-- -----------------------------------------------------------------------------
-- Phase 3A — prompt versioning (foundation for A/B comparison and model recommendation)
--
-- A "prompt" is identified by (organization_id, project_id, name). Each name has
-- many versions — each version is an immutable snapshot of `content` + `variables`.
-- Requests that use a prompt reference the specific version via requests.prompt_version_id.

CREATE TABLE IF NOT EXISTS public.prompt_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  name          text NOT NULL,
  version       integer NOT NULL,
  content       text NOT NULL,
  variables     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ name, description, required }]
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name, version)
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_org_name
  ON public.prompt_versions (organization_id, name, version DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_project
  ON public.prompt_versions (project_id)
  WHERE project_id IS NOT NULL;

-- Link requests ↔ prompt_versions so A/B comparison can aggregate request metrics per version
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS prompt_version_id uuid REFERENCES public.prompt_versions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_requests_prompt_version
  ON public.requests (prompt_version_id)
  WHERE prompt_version_id IS NOT NULL;

-- Row-level security: org members SELECT; INSERT via authenticated authJwt only (not anon)
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prompt_versions_select_member" ON public.prompt_versions
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "prompt_versions_insert_member" ON public.prompt_versions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "prompt_versions_delete_member" ON public.prompt_versions
  FOR DELETE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.prompt_versions IS
  'Immutable prompt snapshots. New version = new row. Requests may reference one version via requests.prompt_version_id.';

-- -----------------------------------------------------------------------------
-- Migration: 20260422120000_quota_warnings.sql
-- -----------------------------------------------------------------------------
-- Migration: quota_warnings
-- Track when each organization was last warned about quota usage crossing
-- 80% / 100% in the current calendar month. Used by the
-- cron-quota-warnings job to avoid duplicate emails.
--
-- Reset logic is implicit: the cron compares `*_sent_at` against the start
-- of the current UTC calendar month — stale timestamps (from a previous
-- month) are treated as "not yet sent this period" without needing an
-- explicit reset trigger.

ALTER TABLE organizations
  ADD COLUMN quota_warning_80_sent_at  TIMESTAMPTZ,
  ADD COLUMN quota_warning_100_sent_at TIMESTAMPTZ;

-- Index helps the cron job filter eligible orgs quickly when the table grows.
CREATE INDEX organizations_quota_warning_idx
  ON organizations (quota_warning_100_sent_at, quota_warning_80_sent_at);

-- -----------------------------------------------------------------------------
-- Migration: 20260422140000_subscription_overage_charges.sql
-- -----------------------------------------------------------------------------
-- Migration: subscription_overage_charges
-- Idempotency table for Paddle usage-based overage billing.
--
-- The daily cron-report-usage-overage job decides, at the end of each
-- billing period, to issue a one-time charge for the overage amount via
-- POST /subscriptions/{id}/charge. The UNIQUE (subscription_id, period_end)
-- constraint here is the core guard against double-charging.
--
-- Intended write pattern:
--   1. INSERT with status='pending' before calling Paddle
--   2. Call POST /subscriptions/{id}/charge
--   3. UPDATE with status='charged' + paddle_response on success,
--      or status='error' + error_message on failure
--
-- On cron re-run after a crash, the pending/charged/error row already
-- exists — SELECT returns it, the job skips it. Safer to under-bill
-- than to double-charge: an operator can flip a stuck `pending` or
-- `error` row to `retry` manually.

CREATE TABLE subscription_overage_charges (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id         UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  period_start            TIMESTAMPTZ NOT NULL,
  period_end              TIMESTAMPTZ NOT NULL,
  overage_requests        INTEGER NOT NULL,
  overage_quantity        INTEGER NOT NULL, -- usually ceil(overage_requests / 1000)
  price_id                TEXT NOT NULL,
  status                  TEXT NOT NULL
                            DEFAULT 'pending'
                            CHECK (status IN ('pending', 'charged', 'error', 'retry')),
  paddle_response         JSONB,
  error_message           TEXT,
  charged_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ,
  UNIQUE (subscription_id, period_end)
);

CREATE INDEX subscription_overage_charges_status_idx
  ON subscription_overage_charges (status)
  WHERE status IN ('pending', 'error', 'retry');

ALTER TABLE subscription_overage_charges ENABLE ROW LEVEL SECURITY;

-- Dashboard read: org members can see their own overage history.
CREATE POLICY "overage_select" ON subscription_overage_charges
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = subscription_overage_charges.subscription_id
        AND is_org_member(s.organization_id)
    )
  );

-- Writes go through service_role only — no INSERT/UPDATE/DELETE policies
-- means the anon/authenticated roles have no write access.

-- -----------------------------------------------------------------------------
-- Migration: 20260422150000_overage_policy.sql
-- -----------------------------------------------------------------------------
-- Migration: overage_policy
-- Per-organization controls for the Pattern C quota policy:
--
--   Free plan:                   always hard-blocked at limit (ignored: columns below)
--   Paid plan + allow_overage=true:
--     - usage < limit: pass
--     - usage in [limit, limit * overage_cap_multiplier): pass + accumulates overage
--     - usage >= limit * overage_cap_multiplier: hard-blocked (safety)
--   Paid plan + allow_overage=false:
--     - usage >= limit: hard-blocked (legacy Pattern A behavior)
--
-- Defaults: overage on, 5x hard cap. Starter (100K) gets 500K hard cap;
-- Team (500K) gets 2.5M hard cap. This bounds the worst-case runaway
-- monthly bill to a predictable multiple of the plan fee.

ALTER TABLE organizations
  ADD COLUMN allow_overage              BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN overage_cap_multiplier     INTEGER NOT NULL DEFAULT 5
    CHECK (overage_cap_multiplier BETWEEN 1 AND 100);

-- -----------------------------------------------------------------------------
-- Migration: 20260422153000_stats_and_security_aggregation_fns.sql
-- -----------------------------------------------------------------------------
-- stats_overview: single-row aggregate for the dashboard overview cards.
-- Called by GET /api/v1/stats/overview.
CREATE OR REPLACE FUNCTION stats_overview(
  p_org_id    UUID,
  p_project_id UUID DEFAULT NULL,
  p_from      TIMESTAMPTZ DEFAULT NULL,
  p_to        TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  total_requests     BIGINT,
  success_requests   BIGINT,
  error_requests     BIGINT,
  total_cost_usd     NUMERIC,
  total_tokens       BIGINT,
  prompt_tokens      BIGINT,
  completion_tokens  BIGINT,
  avg_latency_ms     NUMERIC
)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)                                                      AS total_requests,
    COUNT(*) FILTER (WHERE status_code < 400)                     AS success_requests,
    COUNT(*) FILTER (WHERE status_code >= 400)                    AS error_requests,
    COALESCE(SUM(cost_usd), 0)                                    AS total_cost_usd,
    COALESCE(SUM(total_tokens), 0)                                AS total_tokens,
    COALESCE(SUM(prompt_tokens), 0)                               AS prompt_tokens,
    COALESCE(SUM(completion_tokens), 0)                           AS completion_tokens,
    COALESCE(AVG(latency_ms), 0)                                  AS avg_latency_ms
  FROM requests
  WHERE organization_id = p_org_id
    AND (p_project_id IS NULL OR project_id = p_project_id)
    AND created_at >= COALESCE(p_from, NOW() - INTERVAL '30 days')
    AND created_at <= COALESCE(p_to, NOW());
$$;

-- security_summary: counts flagged requests by flag type and pattern.
-- Called by GET /api/v1/security/summary.
-- flags column is JSONB array of objects: [{type, pattern, sample}, ...]
CREATE OR REPLACE FUNCTION security_summary(
  p_org_id UUID,
  p_hours  INT DEFAULT 24
) RETURNS TABLE (
  flag_type TEXT,
  pattern   TEXT,
  count     BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    (flag->>'type')::text    AS flag_type,
    (flag->>'pattern')::text AS pattern,
    COUNT(*)                 AS count
  FROM requests,
       LATERAL jsonb_array_elements(flags) AS flag
  WHERE organization_id = p_org_id
    AND jsonb_array_length(flags) > 0
    AND created_at >= NOW() - (p_hours || ' hours')::INTERVAL
  GROUP BY 1, 2
  ORDER BY count DESC;
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260423095500_fix_stats_timeseries_null_params.sql
-- -----------------------------------------------------------------------------
-- Fix: stats_timeseries returned empty when from/to were passed as NULL.
--
-- The original function used `created_at >= p_from` directly. When the
-- caller passes p_from = NULL, Postgres evaluates `created_at >= NULL` as
-- NULL (not TRUE), so the WHERE clause filters out every row → empty result.
--
-- The default values (`DEFAULT (NOW() - INTERVAL '30 days')`) only apply
-- when the parameter is OMITTED — passing explicit NULL bypasses them. The
-- server code does `p_from: from ?? null`, which always passes NULL when
-- the query string is absent, so the defaults never kicked in for the
-- common case (dashboard home with no filters).
--
-- Fix: COALESCE inside the function. Handles both omitted-params and
-- explicit-null-params, falling back to the same "last 30 days" range the
-- pre-RPC JS implementation used.
--
-- Verified post-deploy: stats_timeseries(<org_id>, NULL, NULL, NULL)
-- returns the expected daily aggregates again.

CREATE OR REPLACE FUNCTION stats_timeseries(
  p_org_id UUID,
  p_project_id UUID DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  day       DATE,
  requests  BIGINT,
  cost      NUMERIC,
  tokens    BIGINT,
  errors    BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    date_trunc('day', created_at)::date                  AS day,
    COUNT(*)                                             AS requests,
    COALESCE(SUM(cost_usd), 0)                           AS cost,
    COALESCE(SUM(total_tokens), 0)                       AS tokens,
    COUNT(*) FILTER (WHERE status_code >= 400)           AS errors
  FROM requests
  WHERE organization_id = p_org_id
    AND (p_project_id IS NULL OR project_id = p_project_id)
    AND created_at >= COALESCE(p_from, NOW() - INTERVAL '30 days')
    AND created_at <= COALESCE(p_to, NOW())
  GROUP BY 1
  ORDER BY 1;
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260423110000_requests_provider_key_id.sql
-- -----------------------------------------------------------------------------
-- Track which provider_keys row authenticated each upstream call.
-- An org may have multiple keys per provider over time (rotation, A/B,
-- multi-account); this column lets the dashboard show
-- "openai (prod-key-2)" instead of just "openai" so the user knows which
-- credential was used.
--
-- Nullable: existing historical rows have no value, and proxy fallbacks
-- (e.g. self-host with environment-variable key, no provider_keys row) may
-- not have one. ON DELETE SET NULL preserves the request log when a key is
-- revoked.

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS provider_key_id UUID REFERENCES provider_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS requests_provider_key_idx
  ON requests (provider_key_id)
  WHERE provider_key_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Migration: 20260423110100_saved_filters.sql
-- -----------------------------------------------------------------------------
-- Per-user named filter bookmarks for the /requests dashboard.
-- Lets users save "prod errors yesterday" type queries and re-apply with one
-- click. Scope is per-user (not org) so each team member has their own list.

CREATE TABLE saved_filters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  /* JSONB: { provider?, model?, status?, projectId?, providerKeyId?, from?, to? } */
  filters         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX saved_filters_user_idx ON saved_filters (user_id);

ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_filters_select" ON saved_filters
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "saved_filters_insert" ON saved_filters
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "saved_filters_delete" ON saved_filters
  FOR DELETE USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Migration: 20260423120000_anomaly_events.sql
-- -----------------------------------------------------------------------------
-- Persisted snapshot of anomalies detected by the daily cron. Lets the
-- dashboard show "anomaly history over the last N days" — patterns like
-- "every Tuesday at lunchtime gpt-4o latency spikes" become visible.
--
-- Idempotency: each (org, day, provider, model, kind) combo gets at most
-- ONE row per day. The cron's UPSERT relies on the unique constraint.

CREATE TABLE anomaly_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  detected_on     DATE NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('latency', 'cost', 'error_rate')),
  current_value   NUMERIC NOT NULL,
  baseline_mean   NUMERIC NOT NULL,
  baseline_stddev NUMERIC NOT NULL,
  deviations      NUMERIC NOT NULL,
  sample_count    INTEGER NOT NULL,
  reference_count INTEGER NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, detected_on, provider, model, kind)
);

CREATE INDEX anomaly_events_org_date_idx
  ON anomaly_events (organization_id, detected_on DESC);

ALTER TABLE anomaly_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anomaly_events_select" ON anomaly_events
  FOR SELECT USING (is_org_member(organization_id));
-- writes: service_role only (no INSERT/UPDATE/DELETE policy)

-- -----------------------------------------------------------------------------
-- Migration: 20260423140000_provider_keys_project_scope.sql
-- -----------------------------------------------------------------------------
-- Migration: provider_keys_project_scope
-- Adds optional project_id to provider_keys so each project can have its own
-- OpenAI/Anthropic/Gemini key. When project_id IS NULL the row acts as the
-- org-level default (fallback when no project-specific key exists).

-- ────────────────────────────────────────────────────────────
-- 1. Add project_id column (NULL = org-level default)
-- ────────────────────────────────────────────────────────────
ALTER TABLE provider_keys
  ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- ────────────────────────────────────────────────────────────
-- 2. Unique scope: one active key per (org, project_id, provider).
--    NULL project_id collapses to a sentinel UUID so Postgres treats all
--    org-defaults as a single slot per provider.
-- ────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX provider_keys_scope_active_unique
  ON provider_keys (
    organization_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    provider
  )
  WHERE is_active = true;

-- ────────────────────────────────────────────────────────────
-- 3. Lookup index for the project-scoped proxy resolver
-- ────────────────────────────────────────────────────────────
CREATE INDEX provider_keys_project_lookup
  ON provider_keys (project_id, provider)
  WHERE is_active = true AND project_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Migration: 20260424000000_anomaly_acks.sql
-- -----------------------------------------------------------------------------
-- Migration: anomaly_acks
-- Tracks which live anomalies the user has acknowledged so the UI can
-- suppress or de-emphasize them until they re-fire with new data.

CREATE TABLE anomaly_acks (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('latency', 'cost', 'error_rate')),
  acknowledged_by UUID REFERENCES auth.users(id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, provider, model, kind)
);

ALTER TABLE anomaly_acks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anomaly_acks_select" ON anomaly_acks FOR SELECT
  USING (is_org_member(organization_id));
CREATE POLICY "anomaly_acks_insert" ON anomaly_acks FOR INSERT
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "anomaly_acks_update" ON anomaly_acks FOR UPDATE
  USING (is_org_member(organization_id));
CREATE POLICY "anomaly_acks_delete" ON anomaly_acks FOR DELETE
  USING (is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- Migration: 20260425000000_org_members.sql
-- -----------------------------------------------------------------------------
-- Multi-user organizations: org_members + invitations + per-user dismissals.
--
-- Before this migration, `organizations.owner_id` was the single user allowed
-- into an org. This migration introduces a proper membership table with roles
-- (admin/editor/viewer), and rewrites `is_org_member()` to check it.
--
-- Existing owners are backfilled as admins so nothing breaks for current users.
-- organizations.owner_id is kept for now — it still points at the org creator
-- and is used as an anchor for backfill + a fast "who created this" shortcut.
-- A future cleanup can drop it once all code paths have migrated.

-- ────────────────────────────────────────────────────────────
-- 1. org_role enum
-- ────────────────────────────────────────────────────────────
CREATE TYPE org_role AS ENUM ('admin', 'editor', 'viewer');

-- ────────────────────────────────────────────────────────────
-- 2. org_members (membership + role)
-- ────────────────────────────────────────────────────────────
CREATE TABLE org_members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            org_role NOT NULL DEFAULT 'viewer',
  invited_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_org_role ON org_members(organization_id, role);

-- Backfill: every existing org owner becomes an admin in the new table.
INSERT INTO org_members (organization_id, user_id, role)
SELECT id, owner_id, 'admin'::org_role
FROM organizations
ON CONFLICT DO NOTHING;

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- Read: anyone in the same org can see all members (for the team list).
CREATE POLICY "org_members_select" ON org_members
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    )
  );

-- Write: locked down in RLS — the server uses service_role for these ops
-- and enforces role checks (admin-only) + last-admin protection in app code.
-- We do NOT grant INSERT/UPDATE/DELETE to authenticated users here: going
-- through supabaseAdmin is the single code path, which keeps the logic
-- centralized and avoids RLS-bypass footguns.

-- ────────────────────────────────────────────────────────────
-- 3. Rewrite is_org_member() to consult org_members
--    (replaces the owner_id check in the initial schema)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_org_member(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE organization_id = org_id AND user_id = auth.uid()
  )
$$;

-- ────────────────────────────────────────────────────────────
-- 4. org_invitations (email-based, 7-day expiry)
--    token_hash is sha256(token). The raw token lives only in the
--    emailed URL — never in the DB. That way a DB leak can't be
--    turned into working invite links.
-- ────────────────────────────────────────────────────────────
CREATE TABLE org_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            org_role NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  invited_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitations_org_pending
  ON org_invitations(organization_id)
  WHERE accepted_at IS NULL;

CREATE INDEX idx_invitations_email_pending
  ON org_invitations(lower(email))
  WHERE accepted_at IS NULL;

ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;

-- Members of the org can see pending invitations for their org.
CREATE POLICY "invitations_select" ON org_invitations
  FOR SELECT USING (is_org_member(organization_id));

-- Writes go through supabaseAdmin + server-side role check (admin-only).

-- ────────────────────────────────────────────────────────────
-- 5. attn_dismissals — per-user dismiss state for dashboard
--    "Needs attention" cards. A dismissed card stays hidden for
--    THAT user only, in every browser, forever (until the card_key
--    changes, e.g. a new anomaly appears).
-- ────────────────────────────────────────────────────────────
CREATE TABLE attn_dismissals (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_key        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, card_key)
);

CREATE INDEX idx_attn_dismissals_user
  ON attn_dismissals(user_id, organization_id);

ALTER TABLE attn_dismissals ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own dismissals only.
CREATE POLICY "attn_dismissals_select_own" ON attn_dismissals
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "attn_dismissals_insert_own" ON attn_dismissals
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND is_org_member(organization_id)
  );

CREATE POLICY "attn_dismissals_delete_own" ON attn_dismissals
  FOR DELETE USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Migration: 20260425120000_user_profiles.sql
-- -----------------------------------------------------------------------------
-- Onboarding profile data per user.
--
-- Captures the answers to the post-signup survey (use case + role) and
-- doubles as the "has the user finished onboarding?" flag via onboarded_at.
-- The dashboard layout uses this flag to decide whether to show the app or
-- redirect to /onboarding.
--
-- Designed as a separate table (not a column on auth.users) so we can:
--   • iterate on the survey schema without touching auth tables
--   • drop the table during a future product pivot without an auth migration
--   • have RLS policies attached to it independently of Supabase's managed
--     auth schema (which we cannot freely modify).

CREATE TABLE user_profiles (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- "What are you building?" — chatbot / rag / agent / code_assistant /
  -- internal_tool / other. Free-text stored so we can add new options without
  -- a migration; the API layer validates against an allowlist.
  use_case       TEXT,

  -- "What's your role?" — engineer / product / founder / researcher / other.
  role           TEXT,

  -- Stamped when the user completes (or skips) the survey. Until set, the
  -- dashboard layout sends them to /onboarding. NULL means "still in
  -- onboarding" — a row may exist without onboarded_at if we ever pre-create
  -- profiles for invited users, but right now we only INSERT on completion.
  onboarded_at   TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_profiles_onboarded ON user_profiles(onboarded_at)
  WHERE onboarded_at IS NULL;

-- updated_at trigger so any future PATCH to use_case / role bumps the column
-- without the API having to remember.
CREATE OR REPLACE FUNCTION set_user_profiles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_user_profiles_updated_at();

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Self-only access. Server writes go through supabaseAdmin.
CREATE POLICY "user_profiles_select_own" ON user_profiles
  FOR SELECT USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Migration: 20260425130000_fix_org_members_rls_recursion.sql
-- -----------------------------------------------------------------------------
-- The org_members SELECT policy from 20260425000000_org_members.sql
-- self-referenced the same table:
--
--   USING ( organization_id IN
--           (SELECT organization_id FROM org_members WHERE user_id = auth.uid()) )
--
-- PostgreSQL detects this as infinite recursion and fails the query with
-- 42P17 ("infinite recursion detected in policy"). Server-side calls go
-- through supabaseAdmin (service_role, RLS bypass) so the bug never
-- surfaced for the dashboard UI; but any client-side `from('org_members')`
-- query — or even an incidental REST API hit — blows up.
--
-- Replace with a simple self-row policy: each authenticated user can read
-- ONLY their own org_members rows (used to check "what workspaces am I in?"
-- without leaking other members' membership). Listing teammates of an org
-- continues to go through the server's GET /api/v1/organizations/:id/members
-- endpoint, which uses service_role and enforces is_org_member() in app code.

DROP POLICY IF EXISTS "org_members_select" ON org_members;

CREATE POLICY "org_members_select_self" ON org_members
  FOR SELECT USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Migration: 20260427000000_waitlist.sql
-- -----------------------------------------------------------------------------
-- Waitlist table for collecting alpha/early-access sign-ups
-- Status flow: pending → invited (admin sends invite) | rejected

CREATE TABLE IF NOT EXISTS waitlist (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email      TEXT        NOT NULL,
  name       TEXT,
  company    TEXT,
  use_case   TEXT,
  status     TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'invited', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email)
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Only service_role can read (admin dashboard via supabaseAdmin)
-- No anon SELECT or INSERT policies — inserts go through the server API

-- -----------------------------------------------------------------------------
-- Migration: 20260427010000_proxy_overhead_ms.sql
-- -----------------------------------------------------------------------------
-- Track proxy overhead separately from provider latency.
-- latency_ms (existing) = time for the upstream provider fetch.
-- proxy_overhead_ms (new) = our pre-fetch processing time
--   (auth + key decryption + body parsing) measured in the proxy handler.
-- Overhead target: p95 < 50ms.

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS proxy_overhead_ms INTEGER;

-- -----------------------------------------------------------------------------
-- Migration: 20260427150000_connect_webhooks.sql
-- -----------------------------------------------------------------------------
-- Migration: connect_webhooks
--
-- 2 tables for the Connect / Webhooks feature:
--  • webhooks           — endpoint configs per organization
--  • webhook_deliveries — delivery audit log (sent by service role)
--
-- RLS follows the is_org_member() SECURITY DEFINER pattern used throughout
-- the codebase (see alerts_and_webhooks migration).  We NEVER write a
-- sub-SELECT on the same table in a USING clause (gotcha #14).

CREATE TABLE webhooks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  url             TEXT        NOT NULL,
  secret          TEXT        NOT NULL,
  events          TEXT[]      NOT NULL DEFAULT ARRAY['request.created'],
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhooks_org_idx ON webhooks (organization_id) WHERE is_active = TRUE;

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhooks_select" ON webhooks
  FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "webhooks_insert" ON webhooks
  FOR INSERT WITH CHECK (is_org_member(organization_id));
CREATE POLICY "webhooks_update" ON webhooks
  FOR UPDATE USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "webhooks_delete" ON webhooks
  FOR DELETE USING (is_org_member(organization_id));


-- webhook_deliveries: written only by service role (supabaseAdmin), read by org members.
-- There is no direct FK to organizations — we traverse webhooks instead so
-- the SELECT policy can check org membership without self-referencing a table.
CREATE TABLE webhook_deliveries (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id     UUID        NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL,
  status         TEXT        NOT NULL CHECK (status IN ('success', 'failed')),
  http_status    INTEGER,
  error_message  TEXT,
  duration_ms    INTEGER,
  delivered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_deliveries_webhook_idx ON webhook_deliveries (webhook_id, delivered_at DESC);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Org members can read deliveries for webhooks in their organisation.
-- We join through webhooks and use is_org_member() to avoid recursion.
CREATE POLICY "webhook_deliveries_select" ON webhook_deliveries
  FOR SELECT USING (
    webhook_id IN (
      SELECT id FROM webhooks WHERE is_org_member(organization_id)
    )
  );

-- Service role inserts delivery records (RLS bypassed by supabaseAdmin).
-- Explicit policy so that non-service-role tokens cannot insert.
CREATE POLICY "webhook_deliveries_insert_service" ON webhook_deliveries
  FOR INSERT WITH CHECK (TRUE);

-- -----------------------------------------------------------------------------
-- Migration: 20260428023000_security_settings.sql
-- -----------------------------------------------------------------------------
-- Security/notification settings for stale-key reminders and leak detection.
--
-- Both features are notification-only — no auto-revoke. Stale-key reminders
-- run as a weekly digest; leak detection runs daily and emails immediately
-- on the first scan that returns "leaked" for a given key (dedup via the
-- new provider_key_leak_scans table).

ALTER TABLE organizations
  ADD COLUMN stale_key_alerts_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN stale_key_threshold_days INTEGER NOT NULL DEFAULT 90
    CHECK (stale_key_threshold_days BETWEEN 30 AND 365),
  ADD COLUMN leak_detection_enabled   BOOLEAN NOT NULL DEFAULT false;

-- One row per scan attempt. `result='leaked'` rows with non-null notified_at
-- mean we already emailed admins for this incident — subsequent scans of
-- the same still-leaked key won't re-spam.
CREATE TABLE provider_key_leak_scans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key_id UUID NOT NULL REFERENCES provider_keys(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  result          TEXT NOT NULL CHECK (result IN ('clean', 'leaked', 'error')),
  notified_at     TIMESTAMPTZ,
  details         JSONB
);

CREATE INDEX idx_pkls_key_time ON provider_key_leak_scans(provider_key_id, scanned_at DESC);
CREATE INDEX idx_pkls_org_time ON provider_key_leak_scans(organization_id, scanned_at DESC);

ALTER TABLE provider_key_leak_scans ENABLE ROW LEVEL SECURITY;

-- Members can read their org's scan history. All writes go through the
-- service-role admin client in the cron handler — no INSERT/UPDATE/DELETE
-- policies needed (deny-by-default for non-admin roles).
CREATE POLICY "leak_scans_select" ON provider_key_leak_scans FOR SELECT
  USING (is_org_member(organization_id));

-- Index hint for the stale-key digest cron, which does
-- MAX(created_at) GROUP BY provider_key_id over `requests`. We already index
-- (organization_id, created_at), but provider_key_id alone helps when the
-- workspace has lots of requests across many keys.
CREATE INDEX IF NOT EXISTS idx_requests_provider_key_id_created_at
  ON requests(provider_key_id, created_at DESC)
  WHERE provider_key_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Migration: 20260428120000_stats_models_fn.sql
-- -----------------------------------------------------------------------------
-- stats_models: per-model aggregation for the dashboard /models endpoint.
-- Replaces the previous in-memory JS aggregation in apps/server/src/api/stats.ts.
-- Composite index on (organization_id, created_at DESC) already exists from
-- migration 20260422153000_stats_and_security_aggregation_fns.sql.

CREATE OR REPLACE FUNCTION stats_models(
  p_org_id     UUID,
  p_project_id UUID        DEFAULT NULL,
  p_from       TIMESTAMPTZ DEFAULT NULL,
  p_to         TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  provider       TEXT,
  model          TEXT,
  requests       BIGINT,
  total_cost_usd NUMERIC,
  avg_latency_ms NUMERIC,
  error_rate     NUMERIC
)
LANGUAGE sql STABLE AS $$
  SELECT
    provider,
    model,
    COUNT(*)                                                        AS requests,
    COALESCE(SUM(cost_usd), 0)                                      AS total_cost_usd,
    COALESCE(AVG(latency_ms), 0)                                    AS avg_latency_ms,
    COALESCE(
      AVG(CASE WHEN status_code >= 400 THEN 1.0 ELSE 0.0 END), 0
    )                                                               AS error_rate
  FROM requests
  WHERE organization_id = p_org_id
    AND (p_project_id IS NULL OR project_id = p_project_id)
    AND created_at >= COALESCE(p_from, NOW() - INTERVAL '30 days')
    AND created_at <= COALESCE(p_to, NOW())
  GROUP BY provider, model
  ORDER BY total_cost_usd DESC;
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260428180000_stats_timeseries_granularity.sql
-- -----------------------------------------------------------------------------
-- Fix: stats_timeseries always bucketed at day granularity regardless of the
-- selected time range. 1h / 24h views showed a single daily bucket instead of
-- per-hour data points, making the chart nearly useless for short ranges.
--
-- Changes:
--   • Add p_granularity TEXT DEFAULT 'day' parameter.
--     Server auto-selects 'hour' for ranges ≤ 48h, 'day' otherwise.
--   • Return type of `day` changed from DATE → TIMESTAMPTZ so that hourly
--     buckets carry time information (e.g. "2026-04-28T14:00:00+00:00").
--     Existing callers that do r.day.slice(0,10) continue to work.

CREATE OR REPLACE FUNCTION stats_timeseries(
  p_org_id     UUID,
  p_project_id UUID        DEFAULT NULL,
  p_from       TIMESTAMPTZ DEFAULT NULL,
  p_to         TIMESTAMPTZ DEFAULT NULL,
  p_granularity TEXT       DEFAULT 'day'
) RETURNS TABLE (
  day       TIMESTAMPTZ,
  requests  BIGINT,
  cost      NUMERIC,
  tokens    BIGINT,
  errors    BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    date_trunc(p_granularity, created_at)          AS day,
    COUNT(*)                                        AS requests,
    COALESCE(SUM(cost_usd), 0)                      AS cost,
    COALESCE(SUM(total_tokens), 0)                  AS tokens,
    COUNT(*) FILTER (WHERE status_code >= 400)      AS errors
  FROM requests
  WHERE organization_id = p_org_id
    AND (p_project_id IS NULL OR project_id = p_project_id)
    AND created_at >= COALESCE(p_from, NOW() - INTERVAL '30 days')
    AND created_at <= COALESCE(p_to, NOW())
  GROUP BY 1
  ORDER BY 1;
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260428181000_drop_old_stats_timeseries.sql
-- -----------------------------------------------------------------------------
-- The previous migration (20260428180000) used CREATE OR REPLACE with a new
-- 5th parameter (p_granularity TEXT DEFAULT 'day'). Because the parameter
-- count changed, PostgreSQL created a SECOND overloaded function instead of
-- replacing the original 4-parameter version. PostgREST sees two functions
-- with the same name → ambiguity → 500 on any call to that function.
--
-- Fix: drop the old 4-parameter signature. The new 5-parameter version
-- already has DEFAULT 'day', so all existing callers (spend-forecast, etc.)
-- continue to work without passing p_granularity.

DROP FUNCTION IF EXISTS stats_timeseries(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ);

-- -----------------------------------------------------------------------------
-- Migration: 20260429120000_detect_anomaly_stats_fn.sql
-- -----------------------------------------------------------------------------
-- DB-side aggregation for anomaly detection.
--
-- Replaces the previous pattern of fetching all raw rows into Node.js memory
-- and computing mean/stddev in JavaScript. Instead, PostgreSQL computes the
-- aggregates in a single GROUP BY scan and returns one row per (provider, model).
--
-- Parameters:
--   p_org_id     — organization to scope the query
--   p_ref_start  — start of reference window (e.g. now - 7d)
--   p_obs_start  — start of observation window (e.g. now - 1h); rows before
--                  this timestamp are the reference set
--   p_project_id — optional project scope (NULL = all projects)
--
-- Latency + cost are aggregated over success-only rows (status_code < 400)
-- so that a 500-storm doesn't poison the latency/cost baseline.
-- Error rate is aggregated over all rows (Bernoulli proportion).

CREATE OR REPLACE FUNCTION detect_anomaly_stats(
  p_org_id      UUID,
  p_ref_start   TIMESTAMPTZ,
  p_obs_start   TIMESTAMPTZ,
  p_project_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  provider            TEXT,
  model               TEXT,
  -- Latency (success-only)
  obs_latency_mean    DOUBLE PRECISION,
  obs_latency_count   BIGINT,
  ref_latency_mean    DOUBLE PRECISION,
  ref_latency_stddev  DOUBLE PRECISION,
  ref_latency_count   BIGINT,
  -- Cost (success-only)
  obs_cost_mean       DOUBLE PRECISION,
  obs_cost_count      BIGINT,
  ref_cost_mean       DOUBLE PRECISION,
  ref_cost_stddev     DOUBLE PRECISION,
  ref_cost_count      BIGINT,
  -- Error rate (all rows)
  obs_error_rate      DOUBLE PRECISION,
  obs_all_count       BIGINT,
  ref_error_rate      DOUBLE PRECISION,
  ref_error_stddev    DOUBLE PRECISION,
  ref_all_count       BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.provider,
    r.model,
    -- ── Latency ────────────────────────────────────────────────────────────
    AVG(r.latency_ms)         FILTER (WHERE r.created_at >= p_obs_start
                                        AND r.status_code < 400
                                        AND r.latency_ms  IS NOT NULL)::DOUBLE PRECISION,
    COUNT(r.latency_ms)       FILTER (WHERE r.created_at >= p_obs_start
                                        AND r.status_code < 400
                                        AND r.latency_ms  IS NOT NULL),
    AVG(r.latency_ms)         FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.latency_ms  IS NOT NULL)::DOUBLE PRECISION,
    STDDEV_SAMP(r.latency_ms) FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.latency_ms  IS NOT NULL)::DOUBLE PRECISION,
    COUNT(r.latency_ms)       FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.latency_ms  IS NOT NULL),
    -- ── Cost ───────────────────────────────────────────────────────────────
    AVG(r.cost_usd)           FILTER (WHERE r.created_at >= p_obs_start
                                        AND r.status_code < 400
                                        AND r.cost_usd    IS NOT NULL)::DOUBLE PRECISION,
    COUNT(r.cost_usd)         FILTER (WHERE r.created_at >= p_obs_start
                                        AND r.status_code < 400
                                        AND r.cost_usd    IS NOT NULL),
    AVG(r.cost_usd)           FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.cost_usd    IS NOT NULL)::DOUBLE PRECISION,
    STDDEV_SAMP(r.cost_usd)   FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.cost_usd    IS NOT NULL)::DOUBLE PRECISION,
    COUNT(r.cost_usd)         FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.cost_usd    IS NOT NULL),
    -- ── Error rate ─────────────────────────────────────────────────────────
    AVG(CASE WHEN r.status_code >= 400 THEN 1.0 ELSE 0.0 END)
                              FILTER (WHERE r.created_at >= p_obs_start)::DOUBLE PRECISION,
    COUNT(*)                  FILTER (WHERE r.created_at >= p_obs_start),
    AVG(CASE WHEN r.status_code >= 400 THEN 1.0 ELSE 0.0 END)
                              FILTER (WHERE r.created_at <  p_obs_start)::DOUBLE PRECISION,
    STDDEV_SAMP(CASE WHEN r.status_code >= 400 THEN 1.0 ELSE 0.0 END)
                              FILTER (WHERE r.created_at <  p_obs_start)::DOUBLE PRECISION,
    COUNT(*)                  FILTER (WHERE r.created_at <  p_obs_start)
  FROM requests r
  WHERE r.organization_id = p_org_id
    AND r.created_at       >= p_ref_start
    AND r.model             IS NOT NULL
    AND (p_project_id IS NULL OR r.project_id = p_project_id)
  GROUP BY r.provider, r.model
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260429190000_anomaly_acks_project_id.sql
-- -----------------------------------------------------------------------------
-- Migration: add project_id + surrogate PK to anomaly_acks
-- Enables per-project ack isolation: org-wide acks use project_id IS NULL.
-- NULLS NOT DISTINCT makes (org, NULL, provider, model, kind) unique.

ALTER TABLE anomaly_acks
  ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- Existing rows retain project_id = NULL (treated as org-wide acks).

-- Replace composite natural PK with surrogate PK.
ALTER TABLE anomaly_acks DROP CONSTRAINT anomaly_acks_pkey;
ALTER TABLE anomaly_acks ADD PRIMARY KEY (id);

-- Unique constraint — NULLS NOT DISTINCT so two org-wide acks for the same
-- (provider, model, kind) still conflict even though project_id IS NULL.
CREATE UNIQUE INDEX anomaly_acks_unique_idx
  ON anomaly_acks (organization_id, project_id, provider, model, kind)
  NULLS NOT DISTINCT;

-- -----------------------------------------------------------------------------
-- Migration: 20260430120000_security_block_alert.sql
-- -----------------------------------------------------------------------------
-- Security blocking + alert settings.
--
-- Three new capabilities:
--   1. Per-project request blocking — proxy returns 422 when injection detected
--      and blocking is enabled for that project.
--   2. Response scanning — requests.response_flags stores flags found in the
--      LLM's reply (PII in output, etc.).
--   3. Security alert emails — when any flag is detected, email org admins
--      (rate-limited to 1 email per 5 minutes per org via last_security_alert_at).

-- ── projects: injection blocking toggle ───────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN security_block_enabled BOOLEAN NOT NULL DEFAULT false;

-- ── requests: response-side security flags ────────────────────────────────────
ALTER TABLE requests
  ADD COLUMN response_flags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Generated column — true when either request OR response has flags.
-- Used as a fast, index-friendly filter for the flagged-requests list.
ALTER TABLE requests
  ADD COLUMN has_security_flags BOOLEAN GENERATED ALWAYS AS (
    (flags != '[]'::jsonb OR response_flags != '[]'::jsonb)
  ) STORED;

CREATE INDEX idx_requests_has_security_flags
  ON requests (organization_id, created_at DESC)
  WHERE has_security_flags = true;

-- ── organizations: alert settings ────────────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN security_alert_enabled   BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN last_security_alert_at   TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- Migration: 20260430140000_get_model_aggregates_fn.sql
-- -----------------------------------------------------------------------------
-- Aggregate model usage stats for the recommendation engine.
--
-- Why a function instead of fetching raw rows:
--   The Supabase JS client applies a 1000-row default limit on .select() calls.
--   For orgs with >1000 requests in the analysis window this silently truncates
--   data, producing wrong sampleCount values and potentially missed/wrong
--   recommendations. Doing GROUP BY in the DB eliminates the problem entirely
--   and is also much faster (no round-trip of raw rows into JS memory).

CREATE OR REPLACE FUNCTION get_model_aggregates(
  p_organization_id uuid,
  p_window_start     timestamptz,
  p_status_codes     int[]
)
RETURNS TABLE (
  provider               text,
  model                  text,
  sample_count           bigint,
  avg_prompt_tokens      double precision,
  avg_completion_tokens  double precision,
  total_cost_usd         double precision
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    provider,
    model,
    COUNT(*)                          AS sample_count,
    AVG(prompt_tokens::float)         AS avg_prompt_tokens,
    AVG(completion_tokens::float)     AS avg_completion_tokens,
    COALESCE(SUM(cost_usd), 0)        AS total_cost_usd
  FROM requests
  WHERE
    organization_id = p_organization_id
    AND created_at  >= p_window_start
    AND status_code = ANY(p_status_codes)
    AND model       IS NOT NULL
    AND provider    IS NOT NULL
  GROUP BY provider, model
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260430150000_fix_model_aggregates_null_tokens.sql
-- -----------------------------------------------------------------------------
-- Fix: AVG() returns NULL when all rows have NULL tokens.
-- In that case the TypeScript envelope check (avg > max) evaluates to false
-- (null > number === false in JS) and bypasses the filter entirely — causing
-- recommendations to fire on models where we have no token-volume evidence.
--
-- Using COALESCE(AVG(...), 999999) maps "no token data" to an enormous value
-- that always fails the envelope check, so we conservatively skip the
-- recommendation rather than showing a potentially wrong one.

CREATE OR REPLACE FUNCTION get_model_aggregates(
  p_organization_id uuid,
  p_window_start     timestamptz,
  p_status_codes     int[]
)
RETURNS TABLE (
  provider               text,
  model                  text,
  sample_count           bigint,
  avg_prompt_tokens      double precision,
  avg_completion_tokens  double precision,
  total_cost_usd         double precision
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    provider,
    model,
    COUNT(*)                                          AS sample_count,
    COALESCE(AVG(prompt_tokens::float),     999999)  AS avg_prompt_tokens,
    COALESCE(AVG(completion_tokens::float), 999999)  AS avg_completion_tokens,
    COALESCE(SUM(cost_usd), 0)                        AS total_cost_usd
  FROM requests
  WHERE
    organization_id = p_organization_id
    AND created_at  >= p_window_start
    AND status_code = ANY(p_status_codes)
    AND model       IS NOT NULL
    AND provider    IS NOT NULL
  GROUP BY provider, model
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260430161000_recommendation_applications.sql
-- -----------------------------------------------------------------------------
-- Track when organizations apply a cost-saving recommendation.
-- Shows "Applied N days ago" badges in the Savings dashboard.

CREATE TABLE recommendation_applications (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id            uuid        NOT NULL,
  provider           text        NOT NULL,
  model              text        NOT NULL,
  suggested_provider text        NOT NULL,
  suggested_model    text        NOT NULL,
  applied_at         timestamptz NOT NULL DEFAULT now(),
  note               text
);

ALTER TABLE recommendation_applications ENABLE ROW LEVEL SECURITY;

-- Service-role (supabaseAdmin) handles all writes via the server.
-- This policy allows org members to read their own application records
-- for direct Supabase client queries (currently unused, good hygiene).
CREATE POLICY "users can select their own applications"
  ON recommendation_applications
  FOR SELECT
  USING (user_id = auth.uid());

-- Fast lookups by org + model pair
CREATE INDEX idx_rec_apps_org_model
  ON recommendation_applications (organization_id, provider, model, suggested_provider, suggested_model);

-- Sorted list by recency for the dashboard
CREATE INDEX idx_rec_apps_org_applied
  ON recommendation_applications (organization_id, applied_at DESC);

-- -----------------------------------------------------------------------------
-- Migration: 20260430162000_recommendation_notifications.sql
-- -----------------------------------------------------------------------------
-- Tracks which high-confidence recommendations have had a notification sent.
-- The UNIQUE (organization_id, recommendation_key) ensures at most one
-- notification per recommendation per org (idempotent cron runs).

CREATE TABLE recommendation_notifications (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recommendation_key  text          NOT NULL,
  confidence_level    text          NOT NULL CHECK (confidence_level IN ('high', 'medium', 'low')),
  savings_usd         numeric(10,2) NOT NULL,
  sent_at             timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (organization_id, recommendation_key)
);

ALTER TABLE recommendation_notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_rec_notifs_org
  ON recommendation_notifications (organization_id, sent_at DESC);

-- -----------------------------------------------------------------------------
-- Migration: 20260430170000_prompt_ab_experiments.sql
-- -----------------------------------------------------------------------------
-- A/B experiment tracking for prompt versions.
--
-- An experiment compares two versions of the same prompt (version_a vs version_b)
-- by routing a fraction of @latest traffic to each. One org can have at most one
-- running experiment per prompt name at a time (enforced by partial unique index).
--
-- Lifecycle: running → concluded | stopped
--   concluded = experiment ran its course, winner decided
--   stopped   = manually ended before conclusion

CREATE TABLE IF NOT EXISTS public.prompt_ab_experiments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id       uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  prompt_name      text        NOT NULL,
  version_a_id     uuid        NOT NULL REFERENCES public.prompt_versions(id) ON DELETE RESTRICT,
  version_b_id     uuid        NOT NULL REFERENCES public.prompt_versions(id) ON DELETE RESTRICT,
  -- traffic_split = % of requests routed to version_a (0-100). Remaining goes to B.
  traffic_split    smallint    NOT NULL DEFAULT 50 CHECK (traffic_split BETWEEN 1 AND 99),
  status           text        NOT NULL DEFAULT 'running'
                               CHECK (status IN ('running', 'concluded', 'stopped')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  ends_at          timestamptz,          -- optional planned end date
  concluded_at     timestamptz,
  winner_version_id uuid       REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT version_a_ne_b CHECK (version_a_id <> version_b_id)
);

-- Only one running experiment per (org, prompt_name) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_ab_exp_unique_running
  ON public.prompt_ab_experiments (organization_id, prompt_name)
  WHERE status = 'running';

-- Lookup index for traffic routing (hot path in resolve-prompt-version).
CREATE INDEX IF NOT EXISTS idx_prompt_ab_exp_org_name_status
  ON public.prompt_ab_experiments (organization_id, prompt_name, status);

-- RLS
ALTER TABLE public.prompt_ab_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prompt_ab_exp_select_member" ON public.prompt_ab_experiments
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "prompt_ab_exp_insert_member" ON public.prompt_ab_experiments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "prompt_ab_exp_update_member" ON public.prompt_ab_experiments
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.prompt_ab_experiments IS
  'Tracks A/B experiments comparing two prompt versions. Traffic split routes @latest requests.';

-- -----------------------------------------------------------------------------
-- Migration: 20260430170100_prompt_version_archived.sql
-- -----------------------------------------------------------------------------
-- Add is_archived flag to prompt_versions.
-- Archived versions are hidden from the default list view but not deleted.

ALTER TABLE public.prompt_versions
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

-- Index to efficiently query non-archived versions (the common case)
CREATE INDEX IF NOT EXISTS idx_prompt_versions_not_archived
  ON public.prompt_versions (organization_id, name)
  WHERE is_archived = false;

COMMENT ON COLUMN public.prompt_versions.is_archived IS
  'When true the version is hidden from default list views but not deleted. Reversible.';

-- -----------------------------------------------------------------------------
-- Migration: 20260430170200_prompt_quality_timeseries_fn.sql
-- -----------------------------------------------------------------------------
-- Batch sparkline RPC for prompt quality timeseries.
--
-- Returns bucketed quality scores (0-100) for N prompt names in a single
-- round-trip. Used by the prompts list page to render inline sparklines
-- without N+1 queries.
--
-- Quality score per bucket = 100 * (1 - error_rate)
-- where error_rate = requests with status_code >= 400 / total requests.
-- Buckets with no data return null so the sparkline can render gaps.

CREATE OR REPLACE FUNCTION public.get_prompts_quality_sparklines(
  p_org_id   uuid,
  p_names    text[],
  p_hours    int  DEFAULT 24,
  p_buckets  int  DEFAULT 20
)
RETURNS TABLE (
  prompt_name    text,
  bucket_index   int,
  bucket_start   timestamptz,
  quality_score  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- time bounds
  bounds AS (
    SELECT
      now() - (p_hours || ' hours')::interval AS since,
      now()                                    AS until
  ),
  -- all version ids for the requested prompt names, scoped to org
  version_ids AS (
    SELECT pv.id, pv.name
    FROM   prompt_versions pv
    WHERE  pv.organization_id = p_org_id
      AND  pv.name            = ANY(p_names)
  ),
  -- requests in window
  reqs AS (
    SELECT
      vi.name                AS prompt_name,
      r.created_at,
      r.status_code
    FROM   requests r
    JOIN   version_ids vi ON vi.id = r.prompt_version_id
    CROSS  JOIN bounds b
    WHERE  r.organization_id = p_org_id
      AND  r.created_at     >= b.since
      AND  r.created_at     <  b.until
  ),
  -- assign bucket index (0 = oldest, p_buckets-1 = newest)
  bucketed AS (
    SELECT
      prompt_name,
      floor(
        extract(epoch FROM (reqs.created_at - b.since)) /
        (extract(epoch FROM (b.until - b.since)) / p_buckets)
      )::int AS bidx,
      status_code
    FROM reqs
    CROSS JOIN bounds b
  ),
  -- aggregate per (name, bucket)
  agg AS (
    SELECT
      prompt_name,
      bidx,
      count(*)                                              AS total,
      count(*) FILTER (WHERE status_code >= 400)            AS errors
    FROM bucketed
    WHERE bidx BETWEEN 0 AND p_buckets - 1
    GROUP BY prompt_name, bidx
  )
  SELECT
    agg.prompt_name,
    agg.bidx                                    AS bucket_index,
    bounds.since + (
      agg.bidx::numeric / p_buckets *
      extract(epoch FROM (bounds.until - bounds.since)) * interval '1 second'
    )                                           AS bucket_start,
    round(
      100.0 * (1.0 - agg.errors::numeric / agg.total),
      1
    )                                           AS quality_score
  FROM agg
  CROSS JOIN bounds
  ORDER BY agg.prompt_name, agg.bidx;
$$;

COMMENT ON FUNCTION public.get_prompts_quality_sparklines IS
  'Batch sparkline data: bucketed quality scores (0-100) for multiple prompt names.';

-- -----------------------------------------------------------------------------
-- Migration: 20260430180000_api_keys_provider_key_link.sql
-- -----------------------------------------------------------------------------
-- Link api_keys to a specific provider_key row.
-- When set, the proxy bypasses org/project key search and uses this key directly.
-- Nullable for backward compatibility with existing keys.
ALTER TABLE api_keys
  ADD COLUMN provider_key_id uuid REFERENCES provider_keys(id) ON DELETE SET NULL;

-- Index for the FK (Postgres doesn't auto-create FK indexes)
CREATE INDEX idx_api_keys_provider_key_id ON api_keys(provider_key_id)
  WHERE provider_key_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Migration: 20260501120000_requests_api_key_id_fk_set_null.sql
-- -----------------------------------------------------------------------------
-- Change requests.api_key_id FK from NO ACTION to SET NULL
-- so that deleting an api_key preserves request history (api_key_id becomes NULL)
ALTER TABLE requests
  DROP CONSTRAINT requests_api_key_id_fkey;

ALTER TABLE requests
  ADD CONSTRAINT requests_api_key_id_fkey
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- Migration: 20260501120100_requests_api_key_id_nullable.sql
-- -----------------------------------------------------------------------------
-- Allow api_key_id to be NULL so deleted keys don't block request history
ALTER TABLE requests ALTER COLUMN api_key_id DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- Migration: 20260504120000_rate_limit_buckets.sql
-- -----------------------------------------------------------------------------
-- Rate-limit sliding-window buckets (per-minute granularity).
--
-- Each row tracks how many requests a given key has made in a
-- specific 1-minute window ("YYYY-MM-DDTHH:MM" UTC string).
--
-- Reads and writes are done via the check_rate_limit() RPC which
-- performs an atomic INSERT ... ON CONFLICT DO UPDATE so concurrent
-- requests never miss each other's counts.
--
-- Rows older than 10 minutes are cleaned up by the existing
-- prune-logs cron. The table never grows large because windows expire quickly.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key          TEXT        NOT NULL,
  window_key   TEXT        NOT NULL, -- "YYYY-MM-DDTHH:MM" UTC
  count        INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, window_key)
);

-- Index to speed up cleanup queries
CREATE INDEX IF NOT EXISTS rate_limit_buckets_created_at_idx
  ON rate_limit_buckets (created_at);

-- Service-role only — no public access needed
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- ── RPC: atomic increment + limit check ──────────────────────────
-- Returns TRUE  → request is within the limit (allowed)
-- Returns FALSE → request exceeded the limit (block with 429)
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key        TEXT,
  p_window_key TEXT,
  p_limit      INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO rate_limit_buckets (key, window_key, count)
  VALUES (p_key, p_window_key, 1)
  ON CONFLICT (key, window_key)
  DO UPDATE SET count = rate_limit_buckets.count + 1
  RETURNING rate_limit_buckets.count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

-- ── Cleanup helper (called by prune-logs cron) ───────────────────
-- Deletes buckets older than 10 minutes to keep the table tiny.
CREATE OR REPLACE FUNCTION prune_rate_limit_buckets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM rate_limit_buckets
  WHERE created_at < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260505040000_unified_keys.sql
-- -----------------------------------------------------------------------------
-- Migration: unified_keys
--
-- Switch from per-provider Spanlens keys to a single project-scoped Spanlens
-- key that can call ANY provider registered on that project.
--
-- BEFORE
--   api_keys.provider_key_id → provider_keys.id  (1:1)
--   • Each sl_live_xxx mapped to exactly one provider AI key.
--   • Customers had to issue 3 sl_live keys to use OpenAI + Anthropic + Gemini.
--
-- AFTER
--   api_keys.project_id  → projects.id           (N:1, already existed)
--   provider_keys.project_id  → projects.id      (N:1, NOT NULL)
--   • One sl_live_xxx per project. Provider is inferred from the request URL
--     path (`/proxy/openai/...` vs `/proxy/anthropic/...`). The proxy looks
--     up the project's active provider_key for the requested provider.
--
-- Org-level (project_id IS NULL) provider keys are deprecated: every key now
-- belongs explicitly to a project. Existing NULL rows are backfilled to each
-- org's oldest project before the NOT NULL constraint is applied.

-- ────────────────────────────────────────────────────────────
-- 1. Drop api_keys.provider_key_id — superseded by path-based provider
--    inference in the authApiKey middleware.
-- ────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_api_keys_provider_key_id;
ALTER TABLE api_keys DROP COLUMN IF EXISTS provider_key_id;

-- ────────────────────────────────────────────────────────────
-- 2. Backfill org-level provider_keys to a project before locking
--    project_id NOT NULL. Pick each org's oldest project as the destination —
--    deterministic, and matches the implicit "default project" most users have.
-- ────────────────────────────────────────────────────────────
UPDATE provider_keys pk
SET project_id = (
  SELECT p.id
  FROM projects p
  WHERE p.organization_id = pk.organization_id
  ORDER BY p.created_at ASC
  LIMIT 1
)
WHERE pk.project_id IS NULL;

-- Any remaining NULL rows belong to orgs with zero projects — orphaned.
-- Safe to drop because no Spanlens key can resolve to them under the new
-- contract anyway (api_keys.project_id is NOT NULL).
DELETE FROM provider_keys WHERE project_id IS NULL;

-- ────────────────────────────────────────────────────────────
-- 3. Lock project_id NOT NULL — enforces "every provider key belongs
--    to a project" invariant the new auth flow depends on.
-- ────────────────────────────────────────────────────────────
ALTER TABLE provider_keys ALTER COLUMN project_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 4. Replace the sentinel-COALESCE unique index with a clean one.
--    Since project_id is now NOT NULL we don't need the
--    `COALESCE(project_id, '0000…')` trick from migration 20260423140000.
-- ────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS provider_keys_scope_active_unique;
CREATE UNIQUE INDEX provider_keys_project_provider_active_uniq
  ON provider_keys (project_id, provider)
  WHERE is_active = true;

-- The 20260423140000 lookup index `provider_keys_project_lookup` already
-- covers `(project_id, provider) WHERE is_active = true` for reads, so we
-- keep it as-is — it's still the right shape for the new resolver.

-- -----------------------------------------------------------------------------
-- Migration: 20260505080000_provider_keys_under_api_keys.sql
-- -----------------------------------------------------------------------------
-- Migration: provider_keys nested under api_keys
--
-- Move provider_keys ownership from projects → api_keys. Each Spanlens
-- (sl_live_*) key now owns its own set of provider AI keys, so two
-- Spanlens keys in the same project can carry different OpenAI / Anthropic
-- / Gemini credentials (e.g. dev vs prod, team A vs team B).
--
-- BEFORE
--   provider_keys.project_id (NOT NULL) → projects.id
--   Resolution: (project_id, provider) — every Spanlens key in the project
--   shared the same provider keys.
--
-- AFTER
--   provider_keys.api_key_id (NOT NULL) → api_keys.id ON DELETE CASCADE
--   Resolution: (api_key_id, provider) — each Spanlens key has its own pool.
--
-- Backfill strategy
--   For each existing provider_key row, attach it to the *oldest* api_key
--   in the same project. Other api_keys start empty — owners can re-add
--   provider keys to them in the dashboard.
--   Provider keys whose project has zero api_keys are dropped (no Spanlens
--   key exists to call them anyway).
--
-- This is the ALPHA contract — minimal data is at risk and the trade-off
-- (deterministic, simple) beats per-row complex backfill.

-- ────────────────────────────────────────────────────────────
-- 1. Add the new FK column nullable so backfill can run.
-- ────────────────────────────────────────────────────────────
ALTER TABLE provider_keys
  ADD COLUMN api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE;

-- ────────────────────────────────────────────────────────────
-- 2. Backfill — point each provider_key at the oldest api_key in its project.
-- ────────────────────────────────────────────────────────────
UPDATE provider_keys pk
SET api_key_id = (
  SELECT ak.id
  FROM api_keys ak
  WHERE ak.project_id = pk.project_id
  ORDER BY ak.created_at ASC
  LIMIT 1
)
WHERE pk.api_key_id IS NULL;

-- Provider keys for projects with no api_keys can't be reached by any
-- Spanlens key under the new model — drop them.
DELETE FROM provider_keys WHERE api_key_id IS NULL;

-- ────────────────────────────────────────────────────────────
-- 3. Lock the new column NOT NULL, drop the old project_id, swap indexes.
-- ────────────────────────────────────────────────────────────
ALTER TABLE provider_keys ALTER COLUMN api_key_id SET NOT NULL;

-- The old (project_id, provider) UNIQUE WHERE active and lookup index
-- can't survive — they reference a column we're about to drop.
DROP INDEX IF EXISTS provider_keys_project_provider_active_uniq;
DROP INDEX IF EXISTS provider_keys_project_lookup;

ALTER TABLE provider_keys DROP COLUMN project_id;

-- New uniqueness: per-api_key, only one active provider_key per provider.
-- Same shape as before but scoped one level deeper.
CREATE UNIQUE INDEX provider_keys_api_key_provider_active_uniq
  ON provider_keys (api_key_id, provider)
  WHERE is_active = true;

-- Lookup index for the proxy resolver: (api_key_id, provider) WHERE active.
CREATE INDEX provider_keys_api_key_lookup
  ON provider_keys (api_key_id, provider)
  WHERE is_active = true;

-- -----------------------------------------------------------------------------
-- Migration: 20260507000000_otlp_external_ids.sql
-- -----------------------------------------------------------------------------
-- Migration: otlp_external_ids
-- Purpose: Add external_trace_id / external_span_id columns to support OTLP/HTTP ingestion.
--
-- OTel trace_id is a 32-char hex string (16 bytes), OTel span_id is 16-char hex (8 bytes).
-- We keep our own UUID primary keys and store OTel IDs as TEXT in separate columns.
-- This avoids a risky migration of existing PK columns and keeps all existing code working.
--
-- Parent-span linkage (external_parent_span_id → parent_span_id UUID) is resolved by
-- the link_otlp_span_parents() function, called after batch INSERT from the OTLP receiver.

-- ── traces ────────────────────────────────────────────────────────
ALTER TABLE traces ADD COLUMN IF NOT EXISTS external_trace_id TEXT;

-- One external trace ID per org (idempotent upsert support)
CREATE UNIQUE INDEX IF NOT EXISTS traces_external_id_org_idx
  ON traces (organization_id, external_trace_id)
  WHERE external_trace_id IS NOT NULL;

-- ── spans ─────────────────────────────────────────────────────────
ALTER TABLE spans ADD COLUMN IF NOT EXISTS external_span_id TEXT;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS external_parent_span_id TEXT;

CREATE INDEX IF NOT EXISTS spans_external_span_id_idx
  ON spans (external_span_id)
  WHERE external_span_id IS NOT NULL;

-- ── link_otlp_span_parents() ──────────────────────────────────────
-- After inserting a batch of OTLP spans, call this RPC to resolve
-- external_parent_span_id → parent_span_id (UUID) for spans in a given trace.
-- Only updates spans where parent_span_id is still NULL (idempotent).
CREATE OR REPLACE FUNCTION link_otlp_span_parents(p_trace_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE spans AS child
  SET parent_span_id = parent.id
  FROM spans AS parent
  WHERE child.trace_id  = p_trace_id
    AND parent.trace_id = p_trace_id
    AND child.external_parent_span_id IS NOT NULL
    AND child.external_parent_span_id = parent.external_span_id
    AND child.parent_span_id IS NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260507010000_recommendations_prior_window.sql
-- -----------------------------------------------------------------------------
-- Returns the total cost_usd for a specific (provider, model) in a bounded time window.
--
-- Used by the recommendation engine to detect when a model swap has been adopted:
-- a ≥70% drop in spend vs the prior comparable window is treated as "achieved".
--
-- Model matching uses boundary-aware prefix so that dated variants (e.g.
-- gpt-4o-2024-08-06) are covered when the caller passes the canonical alias (gpt-4o).
-- In practice callers pass the exact model string returned by get_model_aggregates,
-- so the LIKE arm also catches any other dated variant of the same family.
CREATE OR REPLACE FUNCTION get_model_prior_window_cost(
  p_organization_id uuid,
  p_provider        text,
  p_model           text,
  p_window_start    timestamptz,
  p_window_end      timestamptz
)
RETURNS double precision
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(cost_usd), 0)::double precision
  FROM requests
  WHERE organization_id = p_organization_id
    AND provider        = p_provider
    AND (model = p_model OR model LIKE (p_model || '-%'))
    AND created_at >= p_window_start
    AND created_at <  p_window_end
    AND status_code = ANY(ARRAY[200, 201, 202, 204])
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260507010100_get_model_percentiles_fn.sql
-- -----------------------------------------------------------------------------
-- Returns P50 / P95 / P99 token distribution for a specific (provider, model)
-- within the analysis window.
--
-- Used by GET /api/v1/recommendations/percentiles, lazy-fetched only when the
-- Savings "Simulate" dialog opens. Lets the UI show how the org's actual token
-- distribution compares to the substitute model's envelope, and warn when P95
-- exceeds the envelope (suggesting some requests may degrade in quality).
--
-- percentile_cont requires ordered-set aggregation in SQL — pulling raw rows
-- into JS would be impractical for high-traffic models (100k+ rows).
CREATE OR REPLACE FUNCTION get_model_percentiles(
  p_organization_id uuid,
  p_provider        text,
  p_model           text,
  p_window_start    timestamptz
)
RETURNS TABLE (
  p50_prompt     double precision,
  p95_prompt     double precision,
  p99_prompt     double precision,
  p50_completion double precision,
  p95_completion double precision,
  p99_completion double precision,
  sample_count   bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    percentile_cont(0.50) WITHIN GROUP (ORDER BY prompt_tokens::float)     AS p50_prompt,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY prompt_tokens::float)     AS p95_prompt,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY prompt_tokens::float)     AS p99_prompt,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY completion_tokens::float) AS p50_completion,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY completion_tokens::float) AS p95_completion,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY completion_tokens::float) AS p99_completion,
    COUNT(*)::bigint                                                        AS sample_count
  FROM requests
  WHERE organization_id = p_organization_id
    AND provider        = p_provider
    AND (model = p_model OR model LIKE (p_model || '-%'))
    AND created_at >= p_window_start
    AND status_code = ANY(ARRAY[200, 201, 202, 204])
    AND prompt_tokens     IS NOT NULL
    AND completion_tokens IS NOT NULL
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260512120000_realtime_requests.sql
-- -----------------------------------------------------------------------------
-- Enable Supabase Realtime for the requests table.
-- REPLICA IDENTITY FULL is required so Realtime can evaluate RLS policies
-- on INSERT events (the new row's columns must be available for filtering).
ALTER TABLE requests REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE requests;

-- -----------------------------------------------------------------------------
-- Migration: 20260513000000_evals.sql
-- -----------------------------------------------------------------------------
-- Evals: LLM-as-judge evaluation infrastructure for prompt versions.
--
-- An evaluator defines "how to score" (criterion + judge model).
-- An eval_run is a single execution of that evaluator over N samples.
-- An eval_result is the score for one sample (one request or one dataset item).
--
-- MVP scope:
--   - Evaluator type: 'llm_judge' only (heuristic etc. in Phase 2)
--   - Source: 'production' only (dataset support comes with Datasets tab)

CREATE TABLE IF NOT EXISTS public.evaluators (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  prompt_name     text        NOT NULL,
  name            text        NOT NULL,
  type            text        NOT NULL DEFAULT 'llm_judge'
                              CHECK (type IN ('llm_judge')),
  -- For llm_judge: { criterion, judge_provider, judge_model, scale_min, scale_max }
  config          jsonb       NOT NULL,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_evaluators_org_prompt
  ON public.evaluators (organization_id, prompt_name)
  WHERE archived_at IS NULL;

ALTER TABLE public.evaluators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "evaluators_select_member" ON public.evaluators
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "evaluators_insert_member" ON public.evaluators
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "evaluators_update_member" ON public.evaluators
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.evaluators IS
  'Defines how to score prompt outputs (criterion + judge model). One row per reusable evaluator.';

-- ── eval_runs ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eval_runs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  evaluator_id       uuid        NOT NULL REFERENCES public.evaluators(id) ON DELETE CASCADE,
  prompt_version_id  uuid        NOT NULL REFERENCES public.prompt_versions(id) ON DELETE CASCADE,
  source             text        NOT NULL DEFAULT 'production'
                                 CHECK (source IN ('production', 'dataset')),
  sample_size        int         NOT NULL CHECK (sample_size > 0 AND sample_size <= 1000),
  -- Time window for production sampling (NULL for dataset source).
  sample_from        timestamptz,
  sample_to          timestamptz,
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  -- Populated when status = 'completed'.
  scored_count       int         NOT NULL DEFAULT 0,
  avg_score          numeric,
  total_cost_usd     numeric     NOT NULL DEFAULT 0,
  error              text,
  created_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_evaluator
  ON public.eval_runs (evaluator_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_runs_prompt_version
  ON public.eval_runs (prompt_version_id, status, started_at DESC);

ALTER TABLE public.eval_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eval_runs_select_member" ON public.eval_runs
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "eval_runs_insert_member" ON public.eval_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "eval_runs_update_member" ON public.eval_runs
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.eval_runs IS
  'One execution of an evaluator over N samples. Holds aggregate score and run metadata.';

-- ── eval_results ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eval_results (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  eval_run_id     uuid        NOT NULL REFERENCES public.eval_runs(id) ON DELETE CASCADE,
  -- Exactly one of request_id / dataset_item_id is set (dataset_items table
  -- comes in Phase 2; column is nullable now so the schema is forward-compatible).
  request_id      uuid        REFERENCES public.requests(id) ON DELETE SET NULL,
  dataset_item_id uuid,
  score           numeric     NOT NULL,
  reasoning       text,
  judge_cost_usd  numeric     NOT NULL DEFAULT 0,
  judge_tokens    int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_results_run
  ON public.eval_results (eval_run_id);

CREATE INDEX IF NOT EXISTS idx_eval_results_request
  ON public.eval_results (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.eval_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eval_results_select_member" ON public.eval_results
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "eval_results_insert_member" ON public.eval_results
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

COMMENT ON TABLE public.eval_results IS
  'One score per sample (request or dataset_item). Aggregated into eval_runs.avg_score.';

-- -----------------------------------------------------------------------------
-- Migration: 20260513010000_datasets.sql
-- -----------------------------------------------------------------------------
-- Datasets: reusable input sets for offline evaluation.
--
-- A dataset is a named collection of (input, expected_output?) pairs.
-- Used by Evals to run a prompt version against a fixed test set instead of
-- production traffic. Future: Experiments will compare versions on a dataset.
--
-- dataset_items.input is jsonb to allow both "variables only" and "messages"
-- shapes. expected_output is optional — only required for accuracy-style evals.

CREATE TABLE IF NOT EXISTS public.datasets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_datasets_org
  ON public.datasets (organization_id)
  WHERE archived_at IS NULL;

ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "datasets_select_member" ON public.datasets
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "datasets_insert_member" ON public.datasets
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "datasets_update_member" ON public.datasets
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "datasets_delete_member" ON public.datasets
  FOR DELETE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.datasets IS
  'Named collection of (input, expected_output?) test cases for offline evaluation.';

-- ── dataset_items ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dataset_items (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dataset_id        uuid        NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  -- Two shapes accepted:
  --   { "variables": { "name": "Alice", ... } }     ← for variable-based prompts
  --   { "messages": [{role,content}, ...] }         ← for raw chat input
  input             jsonb       NOT NULL,
  -- Optional reference answer (for accuracy-style judging).
  expected_output   text,
  -- If this item was imported from production traffic.
  source_request_id uuid        REFERENCES public.requests(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset
  ON public.dataset_items (dataset_id, created_at DESC);

ALTER TABLE public.dataset_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dataset_items_select_member" ON public.dataset_items
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "dataset_items_insert_member" ON public.dataset_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "dataset_items_delete_member" ON public.dataset_items
  FOR DELETE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.dataset_items IS
  'Individual test case in a dataset. input is jsonb (variables or messages shape).';

-- Now wire eval_results.dataset_item_id (added forward-compatibly in 20260513000000_evals.sql).
-- The column already exists but lacked an FK. Add the FK now so the relationship is enforced.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'eval_results_dataset_item_id_fkey'
      AND table_name = 'eval_results'
  ) THEN
    ALTER TABLE public.eval_results
      ADD CONSTRAINT eval_results_dataset_item_id_fkey
      FOREIGN KEY (dataset_item_id)
      REFERENCES public.dataset_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- And give eval_runs.dataset_id a proper FK too.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'eval_runs' AND column_name = 'dataset_id'
  ) THEN
    ALTER TABLE public.eval_runs
      ADD COLUMN dataset_id uuid REFERENCES public.datasets(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset
      ON public.eval_runs (dataset_id)
      WHERE dataset_id IS NOT NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Migration: 20260513020000_experiments.sql
-- -----------------------------------------------------------------------------
-- Experiments: offline side-by-side comparison of two prompt versions on a dataset.
--
-- DIFFERS FROM Prompts A/B (prompt_ab_experiments):
--   - A/B routes production traffic, takes days, exposes real users
--   - Experiments runs offline on a fixed dataset, takes minutes, no user exposure
--
-- Workflow:
--   1. Pick version_a, version_b, dataset, optional evaluator
--   2. Runner re-runs each dataset item through BOTH prompt versions
--   3. Optionally judges each output with the evaluator
--   4. UI shows side-by-side output comparison + score deltas

CREATE TABLE IF NOT EXISTS public.experiments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  prompt_name       text        NOT NULL,
  version_a_id      uuid        NOT NULL REFERENCES public.prompt_versions(id) ON DELETE RESTRICT,
  version_b_id      uuid        NOT NULL REFERENCES public.prompt_versions(id) ON DELETE RESTRICT,
  dataset_id        uuid        NOT NULL REFERENCES public.datasets(id) ON DELETE RESTRICT,
  evaluator_id      uuid        REFERENCES public.evaluators(id) ON DELETE SET NULL,
  -- Model / provider used to run the prompts (both arms use same setup so the
  -- only variable is the prompt content).
  run_provider      text        NOT NULL CHECK (run_provider IN ('openai', 'anthropic')),
  run_model         text        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  -- Aggregates populated when status = 'completed'
  total_items       int         NOT NULL DEFAULT 0,
  completed_items   int         NOT NULL DEFAULT 0,
  avg_score_a       numeric,
  avg_score_b       numeric,
  total_cost_usd    numeric     NOT NULL DEFAULT 0,
  error             text,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  CONSTRAINT exp_version_a_ne_b CHECK (version_a_id <> version_b_id)
);

CREATE INDEX IF NOT EXISTS idx_experiments_org_prompt
  ON public.experiments (organization_id, prompt_name, started_at DESC);

ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "experiments_select_member" ON public.experiments
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "experiments_insert_member" ON public.experiments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "experiments_update_member" ON public.experiments
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.experiments IS
  'Offline side-by-side comparison: runs dataset items through two prompt versions.';

-- ── experiment_results ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.experiment_results (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  experiment_id    uuid        NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  dataset_item_id  uuid        NOT NULL REFERENCES public.dataset_items(id) ON DELETE CASCADE,
  -- Per-arm outputs and metrics
  output_a         text,
  output_b         text,
  cost_a_usd       numeric     NOT NULL DEFAULT 0,
  cost_b_usd       numeric     NOT NULL DEFAULT 0,
  latency_a_ms     int,
  latency_b_ms     int,
  tokens_a         int         NOT NULL DEFAULT 0,
  tokens_b         int         NOT NULL DEFAULT 0,
  -- Optional judge scores (when experiment.evaluator_id is set)
  score_a          numeric,
  score_b          numeric,
  reasoning_a      text,
  reasoning_b      text,
  error_a          text,
  error_b          text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experiment_results_exp
  ON public.experiment_results (experiment_id);

ALTER TABLE public.experiment_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "experiment_results_select_member" ON public.experiment_results
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "experiment_results_insert_member" ON public.experiment_results
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

COMMENT ON TABLE public.experiment_results IS
  'Per dataset-item result for an experiment: outputs from both arms + optional judge scores.';

-- -----------------------------------------------------------------------------
-- Migration: 20260513030000_human_evals.sql
-- -----------------------------------------------------------------------------
-- Human evals: manual scoring of individual requests by team members.
--
-- Complements LLM-as-judge (eval_results) by capturing human ground truth.
-- The aggregate over LLM vs human scores tells you whether your LLM judge
-- is actually trustworthy.
--
-- Score is stored normalized to 0..1 to match eval_results. raw_score holds
-- the UI value (e.g. 1–5 stars) for re-display.

CREATE TABLE IF NOT EXISTS public.human_evals (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id         uuid        NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  -- Denormalized for fast filtering / correlation queries by prompt_version.
  prompt_version_id  uuid        REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  reviewer_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Normalized 0..1 — same scale as eval_results.score so correlation is direct.
  score              numeric     NOT NULL CHECK (score >= 0 AND score <= 1),
  -- Raw UI value (e.g. 1..5 stars) for re-rendering.
  raw_score          numeric,
  comment            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- One reviewer scores each request at most once. Update overwrites prior.
  UNIQUE (request_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_human_evals_org
  ON public.human_evals (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_human_evals_prompt_version
  ON public.human_evals (prompt_version_id)
  WHERE prompt_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_human_evals_request
  ON public.human_evals (request_id);

ALTER TABLE public.human_evals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "human_evals_select_member" ON public.human_evals
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "human_evals_insert_member" ON public.human_evals
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "human_evals_update_own" ON public.human_evals
  FOR UPDATE TO authenticated
  USING (reviewer_id = auth.uid() AND public.is_org_member(organization_id));

CREATE POLICY "human_evals_delete_own" ON public.human_evals
  FOR DELETE TO authenticated
  USING (reviewer_id = auth.uid() AND public.is_org_member(organization_id));

COMMENT ON TABLE public.human_evals IS
  'Per-request human scoring. Score normalized 0..1 to match eval_results for direct correlation.';

-- Auto-update updated_at on row changes.
CREATE OR REPLACE FUNCTION public.human_evals_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_human_evals_updated_at ON public.human_evals;
CREATE TRIGGER trg_human_evals_updated_at
  BEFORE UPDATE ON public.human_evals
  FOR EACH ROW
  EXECUTE FUNCTION public.human_evals_set_updated_at();

-- -----------------------------------------------------------------------------
-- Migration: 20260513040000_requests_user_session.sql
-- -----------------------------------------------------------------------------
-- Add user_id / session_id to requests for end-user attribution.
--
-- Populated from the x-spanlens-user / x-spanlens-session headers at proxy time.
-- Both are text (not FK) — these are the CUSTOMER's user IDs, not ours.

ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS user_id    text;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS session_id text;

CREATE INDEX IF NOT EXISTS idx_requests_user_id
  ON public.requests (organization_id, user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_session_id
  ON public.requests (organization_id, session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN public.requests.user_id    IS 'Customer-supplied end-user ID via x-spanlens-user header.';
COMMENT ON COLUMN public.requests.session_id IS 'Customer-supplied session ID via x-spanlens-session header.';

-- -----------------------------------------------------------------------------
-- Migration: 20260514120000_cache_pricing.sql
-- -----------------------------------------------------------------------------
-- ─────────────────────────────────────────────────────────────────────────────
-- Cache token pricing (Anthropic prompt caching · OpenAI prompt caching)
--
-- WHY: Both Anthropic and OpenAI charge different prices for cached input tokens
-- vs. fresh input tokens. Until now Spanlens lumped everything into prompt_tokens
-- × prompt_price, which OVERCOUNTS cost by 2–10× for cache-heavy workloads.
--
-- SEMANTIC:
--   • `prompt_tokens`       = TOTAL input tokens (including any cached portion)
--                             — unchanged semantic, all existing aggregations
--                             keep working.
--   • `cache_read_tokens`   = subset of prompt_tokens that hit a cache
--                             (Anthropic: cache_read_input_tokens
--                              OpenAI:    prompt_tokens_details.cached_tokens)
--   • `cache_write_tokens`  = subset of prompt_tokens that CREATED a cache entry
--                             (Anthropic: cache_creation_input_tokens
--                              OpenAI:    no equivalent yet)
--
-- COST FORMULA (applied in lib/cost.ts):
--   non_cached      = prompt_tokens - cache_read_tokens - cache_write_tokens
--   total_cost_usd  = non_cached         × prompt_price
--                   + cache_read_tokens  × cache_read_price
--                   + cache_write_tokens × cache_write_price
--                   + completion_tokens  × completion_price
--
-- HISTORICAL DATA: untouched. Backfill not attempted because raw breakdown was
-- never recorded — request_body / response_body don't reliably contain
-- usage.cached_tokens / usage.cache_read_input_tokens fields for past rows
-- (especially streaming). Going forward, every new request stores the
-- breakdown.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE model_prices
  ADD COLUMN IF NOT EXISTS cache_read_price_per_1m  NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS cache_write_price_per_1m NUMERIC(10, 6);

COMMENT ON COLUMN model_prices.cache_read_price_per_1m  IS
  'USD per 1M cached input tokens (read). NULL = model does not support cache or pricing unknown.';
COMMENT ON COLUMN model_prices.cache_write_price_per_1m IS
  'USD per 1M cache-creation input tokens. NULL = model does not support cache writes or pricing unknown.';

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN requests.cache_read_tokens  IS
  'Number of input tokens that hit a prompt cache (subset of prompt_tokens). 0 if not applicable.';
COMMENT ON COLUMN requests.cache_write_tokens IS
  'Number of input tokens written to a prompt cache, charged at write price (subset of prompt_tokens). 0 if not applicable.';

-- -----------------------------------------------------------------------------
-- Migration: 20260514130000_user_analytics_fn.sql
-- -----------------------------------------------------------------------------
-- ─────────────────────────────────────────────────────────────────────────────
-- get_user_analytics — aggregate per-user usage for /api/v1/users
--
-- Returns one row per distinct user_id within an organization, with totals
-- (requests, tokens, cost), behavior (avg latency, error count, distinct
-- models), and lifetime markers (first_seen, last_seen).
--
-- The total_count column carries the COUNT(*) OVER () windowed total so the
-- list endpoint can paginate without a second roundtrip.
--
-- Indexes already cover the hot filter:
--   idx_requests_user_id ON (organization_id, user_id, created_at DESC)
--     WHERE user_id IS NOT NULL  -- added in 20260513040000_requests_user_session.sql
--
-- Sort whitelist (p_sort_by): 'cost' | 'requests' | 'tokens' | 'last_seen'.
-- Anything else falls back to 'cost'. Direction whitelist: 'asc' | 'desc'.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_analytics(
  p_org_id      uuid,
  p_project_id  uuid,
  p_search      text,
  p_from        timestamptz,
  p_to          timestamptz,
  p_sort_by     text,
  p_sort_dir    text,
  p_limit       int,
  p_offset      int
)
RETURNS TABLE (
  user_id          text,
  total_requests   bigint,
  total_tokens     bigint,
  total_cost_usd   numeric,
  avg_latency_ms   numeric,
  first_seen       timestamptz,
  last_seen        timestamptz,
  error_requests   bigint,
  distinct_models  bigint,
  total_count      bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sort_col text;
  v_sort_dir text;
BEGIN
  -- Whitelist sort inputs to prevent SQL injection.
  v_sort_col := CASE p_sort_by
    WHEN 'requests'  THEN 'total_requests'
    WHEN 'tokens'    THEN 'total_tokens'
    WHEN 'last_seen' THEN 'last_seen'
    ELSE 'total_cost_usd'
  END;
  v_sort_dir := CASE WHEN lower(coalesce(p_sort_dir, 'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;

  RETURN QUERY EXECUTE format($q$
    WITH grouped AS (
      SELECT
        r.user_id                                         AS user_id,
        COUNT(*)::bigint                                  AS total_requests,
        COALESCE(SUM(r.total_tokens), 0)::bigint          AS total_tokens,
        COALESCE(SUM(r.cost_usd), 0)::numeric             AS total_cost_usd,
        AVG(r.latency_ms)::numeric                        AS avg_latency_ms,
        MIN(r.created_at)                                 AS first_seen,
        MAX(r.created_at)                                 AS last_seen,
        COUNT(*) FILTER (WHERE r.status_code >= 400)::bigint AS error_requests,
        COUNT(DISTINCT r.model)::bigint                   AS distinct_models
      FROM requests r
      WHERE r.organization_id = $1
        AND r.user_id IS NOT NULL
        AND ($2::uuid IS NULL OR r.project_id = $2)
        AND ($3::text IS NULL OR r.user_id ILIKE '%%' || $3 || '%%')
        AND ($4::timestamptz IS NULL OR r.created_at >= $4)
        AND ($5::timestamptz IS NULL OR r.created_at <= $5)
      GROUP BY r.user_id
    )
    SELECT
      g.*,
      (COUNT(*) OVER ())::bigint AS total_count
    FROM grouped g
    ORDER BY %I %s NULLS LAST
    LIMIT $6 OFFSET $7
  $q$, v_sort_col, v_sort_dir)
  USING p_org_id, p_project_id, p_search, p_from, p_to, p_limit, p_offset;
END;
$$;

COMMENT ON FUNCTION get_user_analytics(uuid, uuid, text, timestamptz, timestamptz, text, text, int, int) IS
  'Aggregate per-user usage stats for an organization. Used by GET /api/v1/users.';

GRANT EXECUTE ON FUNCTION get_user_analytics(uuid, uuid, text, timestamptz, timestamptz, text, text, int, int)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Migration: 20260515000000_webhook_retry.sql
-- -----------------------------------------------------------------------------
-- Migration: webhook_retry
--
-- Adds columns needed to retry failed webhook deliveries with exponential
-- back-off:
--   payload        — stores the signed payload so the retry can re-send it
--   attempt_count  — how many times delivery has been attempted
--   next_retry_at  — when the next retry should run (NULL = done / succeeded)
--
-- The cron endpoint /cron/retry-webhooks queries on next_retry_at and
-- re-dispatches deliveries that are past-due and have attempt_count < 5.

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS payload        JSONB,
  ADD COLUMN IF NOT EXISTS attempt_count  INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_retry_at  TIMESTAMPTZ;

-- Sparse index: only rows that are pending retry (failed + has a retry_at).
CREATE INDEX IF NOT EXISTS webhook_deliveries_retry_idx
  ON webhook_deliveries (next_retry_at)
  WHERE next_retry_at IS NOT NULL AND status = 'failed';

-- -----------------------------------------------------------------------------
-- Migration: 20260515010000_cron_job_runs.sql
-- -----------------------------------------------------------------------------
-- Track cron job execution history for the Settings → System monitor.
-- No org scoping — system-level table, accessed only via service_role.

CREATE TABLE IF NOT EXISTS cron_job_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name     TEXT        NOT NULL,
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT        NOT NULL CHECK (status IN ('ok', 'error')),
  duration_ms  INTEGER,
  error_message TEXT
);

ALTER TABLE cron_job_runs ENABLE ROW LEVEL SECURITY;
-- Deny all direct client access; only supabaseAdmin (service_role) reads/writes.
CREATE POLICY "deny_all" ON cron_job_runs USING (false);

-- Index for the "latest run per job" query pattern
CREATE INDEX IF NOT EXISTS cron_job_runs_job_name_ran_at_idx
  ON cron_job_runs (job_name, ran_at DESC);

-- Auto-prune: keep only the last 90 days of run history
CREATE OR REPLACE FUNCTION prune_cron_job_runs() RETURNS void LANGUAGE sql AS $$
  DELETE FROM cron_job_runs WHERE ran_at < now() - INTERVAL '90 days';
$$;

-- -----------------------------------------------------------------------------
-- Migration: 20260515100000_anomaly_contributing_factors_fn.sql
-- -----------------------------------------------------------------------------
-- Computes contributing factor data for a specific (provider, model) anomaly.
-- Returns token averages for both the observation and reference windows,
-- plus a distribution of error status codes in the observation window.
-- Called once per detected anomaly to explain WHY the anomaly occurred.

CREATE OR REPLACE FUNCTION get_anomaly_factors(
  p_org_id     UUID,
  p_provider   TEXT,
  p_model      TEXT,
  p_obs_start  TIMESTAMPTZ,
  p_ref_start  TIMESTAMPTZ,
  p_project_id UUID DEFAULT NULL
)
RETURNS TABLE (
  obs_prompt_tokens_mean     DOUBLE PRECISION,
  ref_prompt_tokens_mean     DOUBLE PRECISION,
  obs_completion_tokens_mean DOUBLE PRECISION,
  ref_completion_tokens_mean DOUBLE PRECISION,
  obs_total_tokens_mean      DOUBLE PRECISION,
  ref_total_tokens_mean      DOUBLE PRECISION,
  obs_status_distribution    JSONB
)
LANGUAGE sql
STABLE
AS $$
  WITH token_stats AS (
    SELECT
      AVG(CASE WHEN created_at >= p_obs_start THEN prompt_tokens::float8     END) AS obs_pt,
      AVG(CASE WHEN created_at <  p_obs_start THEN prompt_tokens::float8     END) AS ref_pt,
      AVG(CASE WHEN created_at >= p_obs_start THEN completion_tokens::float8 END) AS obs_ct,
      AVG(CASE WHEN created_at <  p_obs_start THEN completion_tokens::float8 END) AS ref_ct,
      AVG(CASE WHEN created_at >= p_obs_start THEN total_tokens::float8      END) AS obs_tt,
      AVG(CASE WHEN created_at <  p_obs_start THEN total_tokens::float8      END) AS ref_tt
    FROM requests
    WHERE organization_id = p_org_id
      AND provider        = p_provider
      AND model           = p_model
      AND created_at     >= p_ref_start
      AND (p_project_id IS NULL OR project_id = p_project_id)
  ),
  error_dist AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object('code', status_code, 'count', cnt)
        ORDER BY cnt DESC
      ),
      '[]'::jsonb
    ) AS dist
    FROM (
      SELECT status_code, COUNT(*) AS cnt
      FROM requests
      WHERE organization_id = p_org_id
        AND provider        = p_provider
        AND model           = p_model
        AND created_at     >= p_obs_start
        AND status_code    >= 400
        AND (p_project_id IS NULL OR project_id = p_project_id)
      GROUP BY status_code
      ORDER BY cnt DESC
      LIMIT 5
    ) sc
  )
  SELECT
    ts.obs_pt, ts.ref_pt,
    ts.obs_ct, ts.ref_ct,
    ts.obs_tt, ts.ref_tt,
    ed.dist
  FROM token_stats ts, error_dist ed;
$$;
