-- Migration: spans_orphan_index
-- Purpose: Partial index for fast lookup of orphan spans — spans whose
-- OTLP parent (external_parent_span_id) is set but whose Spanlens
-- parent_span_id UUID is still NULL.
--
-- Need: R-14 (Sprint 5) removes the synchronous link_otlp_span_parents()
-- RPC call from the OTLP receiver. Instead a background_migrations job
-- `orphan-span-link` scans for these rows in chunks and a cron
-- (`/cron/detect-orphan-spans`) alerts if too many accumulate. Both
-- workflows scan `WHERE external_parent_span_id IS NOT NULL AND
-- parent_span_id IS NULL`, which would otherwise be a full-table scan
-- on the spans table.
--
-- Why partial: spans with parent_span_id already set are >99% of the
-- table (parents typically arrive before children in OTLP batches that
-- still hit the sync RPC). A partial index over only the orphan subset
-- stays small (~MB-scale) even at trace-table sizes.

CREATE INDEX IF NOT EXISTS spans_orphan_external_parent_idx
  ON spans (external_parent_span_id)
  WHERE external_parent_span_id IS NOT NULL AND parent_span_id IS NULL;
