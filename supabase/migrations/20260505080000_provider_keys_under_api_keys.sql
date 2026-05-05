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
