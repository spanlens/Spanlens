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
