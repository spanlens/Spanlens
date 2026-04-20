-- Migration: initial_schema
-- Tables: organizations, projects, api_keys, provider_keys,
--         model_prices, requests, usage_daily, audit_logs

-- ────────────────────────────────────────────────────────────
-- Helper: org membership check (used by RLS policies)
-- SECURITY DEFINER so it can bypass RLS on organizations itself
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
