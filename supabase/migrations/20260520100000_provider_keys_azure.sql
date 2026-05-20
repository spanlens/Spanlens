-- Migration: provider_keys — add 'azure' provider + provider_metadata jsonb
--
-- PR-A1 of integrations-expansion (Azure OpenAI + Ollama). See
-- docs/plans/integrations-expansion-azure-ollama.md.
--
-- Two changes:
--   1. Extend the provider CHECK constraint to allow 'azure'.
--   2. Add provider_metadata jsonb for provider-specific config that
--      doesn't fit a typed column. For 'azure' we store the customer's
--      Azure resource endpoint there:
--          { "resource_url": "https://my-resource.openai.azure.com" }
--      Other providers (openai/anthropic/gemini) keep the default `{}`.
--
-- A jsonb column is used over per-provider typed columns so future
-- additions (AWS Bedrock region, GCP project_id, etc.) don't require
-- another schema migration each time.

-- ────────────────────────────────────────────────────────────
-- 1. Swap the CHECK constraint to include 'azure'.
-- ────────────────────────────────────────────────────────────
-- The constraint was defined inline in the initial schema, so PG
-- auto-named it provider_keys_provider_check. Use IF EXISTS in case
-- a future migration ever renames it.
ALTER TABLE provider_keys
  DROP CONSTRAINT IF EXISTS provider_keys_provider_check;

ALTER TABLE provider_keys
  ADD CONSTRAINT provider_keys_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini', 'azure'));

-- ────────────────────────────────────────────────────────────
-- 2. provider_metadata jsonb column.
-- ────────────────────────────────────────────────────────────
ALTER TABLE provider_keys
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN provider_keys.provider_metadata IS
  'Provider-specific metadata. For azure: {"resource_url": "https://<name>.openai.azure.com"}. Empty {} for openai/anthropic/gemini.';

-- ────────────────────────────────────────────────────────────
-- 3. Constraint: azure rows must carry a resource_url.
-- ────────────────────────────────────────────────────────────
-- Validates at INSERT/UPDATE time so the proxy resolver never has to
-- defensively handle "azure key with no endpoint" — the DB rejects
-- such rows up front.
ALTER TABLE provider_keys
  ADD CONSTRAINT provider_keys_azure_requires_resource_url
  CHECK (
    provider <> 'azure'
    OR (provider_metadata ? 'resource_url'
        AND length(provider_metadata->>'resource_url') > 0)
  );
