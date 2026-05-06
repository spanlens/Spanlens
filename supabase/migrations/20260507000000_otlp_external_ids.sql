-- Migration: otlp_external_ids
-- Purpose: Add external_trace_id / external_span_id columns to support OTLP/HTTP ingestion.
--
-- OTel trace_id is a 32-char hex string (16 bytes), OTel span_id is 16-char hex (8 bytes).
-- We keep our own UUID primary keys and store OTel IDs as TEXT in separate columns.
-- This avoids a risky migration of existing PK columns and keeps all existing code working.
--
-- Parent-span linkage (external_parent_span_id → parent_span_id UUID) is resolved by
-- the link_otlp_span_parents() function, called after batch INSERT from the OTLP receiver.

-- ── traces ────────────────────────────────────────────────────────
ALTER TABLE traces ADD COLUMN IF NOT EXISTS external_trace_id TEXT;

-- One external trace ID per org (idempotent upsert support)
CREATE UNIQUE INDEX IF NOT EXISTS traces_external_id_org_idx
  ON traces (organization_id, external_trace_id)
  WHERE external_trace_id IS NOT NULL;

-- ── spans ─────────────────────────────────────────────────────────
ALTER TABLE spans ADD COLUMN IF NOT EXISTS external_span_id TEXT;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS external_parent_span_id TEXT;

CREATE INDEX IF NOT EXISTS spans_external_span_id_idx
  ON spans (external_span_id)
  WHERE external_span_id IS NOT NULL;

-- ── link_otlp_span_parents() ──────────────────────────────────────
-- After inserting a batch of OTLP spans, call this RPC to resolve
-- external_parent_span_id → parent_span_id (UUID) for spans in a given trace.
-- Only updates spans where parent_span_id is still NULL (idempotent).
CREATE OR REPLACE FUNCTION link_otlp_span_parents(p_trace_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE spans AS child
  SET parent_span_id = parent.id
  FROM spans AS parent
  WHERE child.trace_id  = p_trace_id
    AND parent.trace_id = p_trace_id
    AND child.external_parent_span_id IS NOT NULL
    AND child.external_parent_span_id = parent.external_span_id
    AND child.parent_span_id IS NULL;
END;
$$;
