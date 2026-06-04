-- Migration: api_keys.scope
--
-- Adds a permission tier to Spanlens (sl_live_*) keys so that customers can
-- mint a read-only key for surfaces that don't need write access but DO put
-- the key in a high-leak-surface location:
--   • MCP servers configured in IDE settings (`~/.cursor/mcp.json` etc.)
--   • BI/dashboard tools that embed the key in connection strings
--   • Public read-only embeds (share links that fan out beyond the org)
--
-- Auth layer enforces this in `apps/server/src/middleware/requireFullScope.ts`:
-- `readonly` keys are rejected (403) by /proxy/*, /ingest/*, and /v1/traces
-- (OTLP). Read endpoints (/api/v1/stats/*, /api/v1/requests, /me/key-info)
-- accept both scopes.
--
-- Existing keys are backfilled to `full` so nothing breaks for current users.
-- The prefix convention is purely a UX hint:
--   sl_live_*       → full (existing)
--   sl_live_ro_*    → readonly (new)
-- The scope COLUMN is the source of truth for authorization; lookup is still
-- by `key_hash` (see authApiKey.ts), unchanged.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'full'
  CHECK (scope IN ('full', 'readonly'));

-- Index on (project_id, scope) so the UI can quickly filter keys by tier
-- without scanning the project's whole key list. Small table per org but
-- it's the natural shape of the "show me all read-only keys for this
-- project" query the dashboard will run.
CREATE INDEX IF NOT EXISTS api_keys_project_scope_idx
  ON api_keys (project_id, scope);
