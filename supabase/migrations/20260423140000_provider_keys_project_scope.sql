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
