-- Migration: api_keys public scope (workspace-level keys)
--
-- Adds a `public` scope to api_keys so customers can mint a workspace-level
-- key that is safe to paste into high-leak-surface locations:
--   • MCP servers configured in IDE settings (~/.cursor/mcp.json etc.)
--   • BI/dashboard tools embedding the key in a connection string
--   • Public read embeds whose URLs fan out beyond the org
--
-- Two ownership patterns coexist after this migration:
--   • scope = 'full'   → project_id NOT NULL, organization_id NULL
--                       (existing "Spanlens key per project" model — unchanged)
--   • scope = 'public' → project_id NULL, organization_id NOT NULL
--                       (new workspace-level key — read-only data access)
--
-- Auth enforcement:
--   /proxy/*, /ingest/*, OTLP /v1/traces        → require scope='full'
--     (see apps/server/src/middleware/requireFullScope.ts)
--   /api/v1/* read endpoints                   → accept JWT OR sl_live_*
--     (see apps/server/src/middleware/authJwtOrApiKey.ts)
--
-- Prefix convention (UX hint only — lookup is still by key_hash):
--   sl_live_<hex>      → full
--   sl_live_pub_<hex>  → public
--
-- PII masking already covers sl_live_pub_* via the existing sl_live_ regex
-- in apps/server/src/lib/pii-mask.ts — no change needed there.

-- ────────────────────────────────────────────────────────────
-- 1. Add scope column (default 'full' so all existing rows are unchanged)
-- ────────────────────────────────────────────────────────────
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'full'
  CHECK (scope IN ('full', 'public'));

-- ────────────────────────────────────────────────────────────
-- 2. Add organization_id column for workspace-level public keys
-- ────────────────────────────────────────────────────────────
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES organizations(id) ON DELETE CASCADE;

-- ────────────────────────────────────────────────────────────
-- 3. Relax project_id NOT NULL so public keys can omit it
--    (unified-keys migration in 20260505040000 had locked it NOT NULL)
-- ────────────────────────────────────────────────────────────
ALTER TABLE api_keys
  ALTER COLUMN project_id DROP NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 4. Constraint: scope value determines which owner column is set
--    full   → project_id set,    organization_id null
--    public → organization_id set, project_id null
--
-- This is the single source of truth for ownership semantics. Inserts that
-- violate it fail at the DB layer — no application-level bug can produce a
-- malformed row.
-- ────────────────────────────────────────────────────────────
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_scope_owner_consistency
  CHECK (
    (scope = 'full'   AND project_id IS NOT NULL AND organization_id IS NULL)
    OR
    (scope = 'public' AND project_id IS NULL AND organization_id IS NOT NULL)
  );

-- ────────────────────────────────────────────────────────────
-- 5. Lookup index for "list public keys for this org"
--    Partial index — full keys are looked up by project, not by org here.
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS api_keys_org_scope_idx
  ON api_keys (organization_id, scope)
  WHERE organization_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 6. Update RLS policies to accept BOTH ownership patterns
--    Existing policies JOIN through projects to check org membership; that
--    JOIN returns 0 rows for public keys (project_id NULL). Rewrite each
--    policy as "match via project OR match via organization_id directly."
--
-- Server code uses supabaseAdmin (RLS bypass) so this only matters if any
-- web flow ever queries api_keys via the anon client — but keeping policies
-- consistent prevents future regressions.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "api_key_select" ON api_keys;
DROP POLICY IF EXISTS "api_key_insert" ON api_keys;
DROP POLICY IF EXISTS "api_key_update" ON api_keys;
DROP POLICY IF EXISTS "api_key_delete" ON api_keys;

CREATE POLICY "api_key_select" ON api_keys FOR SELECT
  USING (
    (project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = api_keys.project_id
        AND is_org_member(p.organization_id)
    ))
    OR
    (organization_id IS NOT NULL AND is_org_member(organization_id))
  );

CREATE POLICY "api_key_insert" ON api_keys FOR INSERT
  WITH CHECK (
    (project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = api_keys.project_id
        AND is_org_member(p.organization_id)
    ))
    OR
    (organization_id IS NOT NULL AND is_org_member(organization_id))
  );

CREATE POLICY "api_key_update" ON api_keys FOR UPDATE
  USING (
    (project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = api_keys.project_id
        AND is_org_member(p.organization_id)
    ))
    OR
    (organization_id IS NOT NULL AND is_org_member(organization_id))
  );

CREATE POLICY "api_key_delete" ON api_keys FOR DELETE
  USING (
    (project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = api_keys.project_id
        AND is_org_member(p.organization_id)
    ))
    OR
    (organization_id IS NOT NULL AND is_org_member(organization_id))
  );
