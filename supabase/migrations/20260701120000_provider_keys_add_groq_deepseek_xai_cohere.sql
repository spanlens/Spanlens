-- Migration: provider_keys — extend provider CHECK to allow the four new
-- OpenAI-compatible providers 'groq', 'deepseek', 'xai', and 'cohere'.
--
-- The proxy routes (apps/server/src/proxy/{groq,deepseek,xai,cohere}.ts) and
-- the app-layer validator in apps/server/src/api/providerKeys.ts now accept
-- all four, but the DB CHECK constraint (last set in
-- 20260613030000_provider_keys_mistral_openrouter.sql) still rejects rows with
-- provider outside openai/anthropic/gemini/azure/mistral/openrouter. Without
-- this, any UI attempt to register a Groq / DeepSeek / xAI / Cohere key 500s
-- on check_violation.
--
-- Same swap-with-IF-EXISTS pattern the mistral/openrouter + azure migrations
-- used. The constraint name (provider_keys_provider_check) is the PG-default
-- for the inline CHECK in the initial schema.

ALTER TABLE provider_keys
  DROP CONSTRAINT IF EXISTS provider_keys_provider_check;

ALTER TABLE provider_keys
  ADD CONSTRAINT provider_keys_provider_check
  CHECK (provider IN (
    'openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter',
    'groq', 'deepseek', 'xai', 'cohere'
  ));
