-- Migration: provider_keys — extend provider CHECK to allow 'mistral' and 'openrouter'.
--
-- The proxy routes (PR #327 Mistral, PR #328 OpenRouter) shipped earlier this
-- week and the app-layer validator in apps/server/src/api/providerKeys.ts now
-- accepts both, but the DB CHECK constraint (created in
-- 20260520100000_provider_keys_azure.sql) still rejects rows with
-- provider != openai/anthropic/gemini/azure. Result: any UI attempt to
-- register a Mistral or OpenRouter key 500s on check_violation.
--
-- Same swap-with-IF-EXISTS pattern the azure migration used. The constraint
-- name (provider_keys_provider_check) is the PG-default for inline CHECKs in
-- the initial schema.

ALTER TABLE provider_keys
  DROP CONSTRAINT IF EXISTS provider_keys_provider_check;

ALTER TABLE provider_keys
  ADD CONSTRAINT provider_keys_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter'));
