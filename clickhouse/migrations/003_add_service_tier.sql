-- 003_add_service_tier.sql
-- Adds the `service_tier` column captured from provider response bodies.
--
-- WHY: OpenAI and Gemini both expose the actual processing tier in the
-- response (`service_tier` for OpenAI, `usageMetadata.serviceTier` for
-- Gemini). Storing it lets the cost calculator apply the correct multiplier
-- (Standard / Flex / Priority / Batch / Auto) and unlocks tier-distribution
-- analytics on the dashboard.
--
-- WHY LowCardinality: distinct values are a fixed enum-like set
-- ('default', 'auto', 'flex', 'priority', 'scale', 'batch', NULL/unknown).
-- LowCardinality stores them as a dictionary — minimal space + faster filters.
--
-- BACKFILL: existing rows default to '' (empty string ≡ "tier unknown").
-- The application code treats '' the same as NULL — no tier multiplier
-- applied. CH MergeTree handles DEFAULT columns lazily on read.
--
-- IDEMPOTENT (CLAUDE.md DB rule): IF NOT EXISTS for ALTER. Safe to apply
-- against a populated table — metadata-only change in CH.

ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS service_tier LowCardinality(String) DEFAULT '';
