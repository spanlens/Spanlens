-- 20260619000000_customer_rate_limits.sql
--
-- Phase 2 of the platform review roadmap: customer-configurable rate limiting.
--
-- Unlike the platform per-minute ceiling (PROXY_RATE_LIMITS, anti-runaway only,
-- pass-through on overage) and the monthly quota (monetization), these are
-- limits the CUSTOMER sets on their own keys / projects / end-users. When one
-- is exceeded we DO return 429 to the customer's end-user, because the customer
-- configured it to throttle their own traffic (matches Helicone/Portkey/LiteLLM).
--
-- One polymorphic table covers all three granularities so the restore UI,
-- the proxy lookup, and the CRUD API stay in one place:
--   • api_key   — a cap on one Spanlens key (all traffic through that key)
--   • project   — a cap across every key in a project
--   • end_user  — a cap per end-user identifier (the x-spanlens-user header),
--                 scoped to a specific Spanlens key
--
-- organization_id is always set (tenant isolation + RLS anchor) regardless of
-- which target the limit points at. Enforcement lives in
-- apps/server/src/middleware/customerRateLimit.ts (mounted after proxyRateLimit)
-- and reuses the Upstash sliding-window limiter via lib/rate-limit.ts.

CREATE TABLE IF NOT EXISTS customer_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  target_type TEXT NOT NULL CHECK (
    target_type IN ('api_key', 'project', 'end_user')
  ),

  -- Set for target_type='api_key' AND target_type='end_user' (the key the
  -- end-user limit is scoped to). NULL for target_type='project'.
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  -- Set only for target_type='project'.
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  -- The x-spanlens-user value. Set only for target_type='end_user'.
  end_user_id TEXT,

  max_requests INTEGER NOT NULL CHECK (max_requests > 0),
  -- Restricted set keeps the @upstash/ratelimit limiter cache bounded
  -- (one limiter instance per distinct (limit, window) pair).
  window_seconds INTEGER NOT NULL DEFAULT 60 CHECK (
    window_seconds IN (60, 3600, 86400)
  ),

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Enforce that the target columns match the discriminator at the DB level so
  -- an app-layer bug can never create an inconsistent row (mirrors the
  -- api_keys_scope_owner_consistency pattern in 20260604040000).
  CONSTRAINT customer_rate_limits_target_consistency CHECK (
    (target_type = 'api_key'
      AND api_key_id IS NOT NULL AND project_id IS NULL AND end_user_id IS NULL)
    OR (target_type = 'project'
      AND project_id IS NOT NULL AND api_key_id IS NULL AND end_user_id IS NULL)
    OR (target_type = 'end_user'
      AND api_key_id IS NOT NULL AND end_user_id IS NOT NULL AND project_id IS NULL)
  )
);

-- One limit row per target. The CRUD API toggles is_active in place rather than
-- creating a second row, and translates the unique violation (23505) to a 409.
CREATE UNIQUE INDEX IF NOT EXISTS customer_rate_limits_api_key_uniq
  ON customer_rate_limits (api_key_id)
  WHERE target_type = 'api_key';

CREATE UNIQUE INDEX IF NOT EXISTS customer_rate_limits_project_uniq
  ON customer_rate_limits (project_id)
  WHERE target_type = 'project';

CREATE UNIQUE INDEX IF NOT EXISTS customer_rate_limits_end_user_uniq
  ON customer_rate_limits (api_key_id, end_user_id)
  WHERE target_type = 'end_user';

-- Proxy hot-path lookup: all active limits for a key (key-level + its end-user
-- limits) and a project's limit, fetched in one select per request (cached).
CREATE INDEX IF NOT EXISTS customer_rate_limits_api_key_active_idx
  ON customer_rate_limits (api_key_id, is_active);

CREATE INDEX IF NOT EXISTS customer_rate_limits_project_active_idx
  ON customer_rate_limits (project_id, is_active);

-- Keep updated_at fresh on UPDATE (shared trigger fn from 20260420000000).
CREATE OR REPLACE TRIGGER customer_rate_limits_updated_at
  BEFORE UPDATE ON customer_rate_limits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE customer_rate_limits ENABLE ROW LEVEL SECURITY;

-- Members of the org can list. Writes go through the server with service_role.
CREATE POLICY customer_rate_limits_select ON customer_rate_limits
  FOR SELECT USING (is_org_member(organization_id));

-- Explicit deny-all for anon + authenticated on write paths. The server uses
-- supabaseAdmin (service_role) which bypasses RLS.
CREATE POLICY customer_rate_limits_deny_writes ON customer_rate_limits
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Allow service_role writes explicitly so the restrictive policy above does
-- not block legitimate server writes when RLS is forced on.
CREATE POLICY customer_rate_limits_service_role_all ON customer_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
