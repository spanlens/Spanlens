-- Migration: fix_otlp_traces_unique_index
-- Fixes: OTLP /v1/traces upsert failed with
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Root cause:
--   20260507000000_otlp_external_ids.sql created a PARTIAL unique index:
--     CREATE UNIQUE INDEX ... (organization_id, external_trace_id)
--       WHERE external_trace_id IS NOT NULL;
--
--   PostgreSQL's ON CONFLICT (cols) inference does NOT match a partial index
--   unless the query also names the WHERE clause (ON CONFLICT (cols) WHERE ...).
--   The Supabase JS client emits the short form only, so every OTLP trace upsert
--   threw the "no matching constraint" error and rejected every span.
--
-- Fix:
--   Replace the partial index with a plain unique index covering ALL rows.
--   PostgreSQL treats NULLs as distinct by default (NULLS DISTINCT), so legacy
--   SDK-ingested traces (external_trace_id IS NULL) still coexist freely.
--   OTLP always sets external_trace_id, so the index is effective there.
--
-- Verified manually: 2026-06-01 OTLP smoke test against server.spanlens.io
-- returned partialSuccess.rejectedSpans=1 before this migration, {} after.

DROP INDEX IF EXISTS traces_external_id_org_idx;

CREATE UNIQUE INDEX IF NOT EXISTS traces_external_id_org_idx
  ON traces (organization_id, external_trace_id);
