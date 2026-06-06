-- 007_rebuild_events_as_requests_view.sql
-- Phase 5.1 PR-5 — refresh the `events_as_requests` view to project
-- the real `flags` / `response_flags` / `has_security_flags` / `truncated`
-- columns that migration 006 added to `events`, instead of the
-- literal placeholders the 005 view returned.
--
-- Why a separate migration: 005 has already shipped to production with
-- the placeholder columns. CREATE VIEW IF NOT EXISTS is a no-op when
-- the view exists, so the only way to pick up the new projection is to
-- drop the old view and recreate it. CLAUDE.md forbids editing past
-- migrations, so the rebuild lives here.
--
-- ORDER OF OPERATIONS: this migration MUST run after 006 (which adds
-- the underlying columns). `pnpm ch:migrate` applies in lexical
-- order, so the 006 → 007 sequence is correct as-is.
--
-- IDEMPOTENT: DROP IF EXISTS + CREATE OR REPLACE. Safe to re-run.
-- ClickHouse's DROP VIEW is metadata-only and never touches the
-- underlying `events` rows.

DROP VIEW IF EXISTS events_as_requests;

CREATE VIEW events_as_requests AS
SELECT
    event_id                                                       AS id,
    organization_id,
    project_id,
    api_key_id,

    provider,
    model,

    toUInt32OrZero(toString(usage_details['prompt_tokens']))       AS prompt_tokens,
    toUInt32OrZero(toString(usage_details['completion_tokens']))   AS completion_tokens,
    toUInt32OrZero(toString(usage_details['total_tokens']))        AS total_tokens,
    toUInt32OrZero(toString(usage_details['cache_read_tokens']))   AS cache_read_tokens,
    toUInt32OrZero(toString(usage_details['cache_write_tokens']))  AS cache_write_tokens,

    total_cost_usd                                                 AS cost_usd,
    duration_ms                                                    AS latency_ms,
    CAST(NULL, 'Nullable(UInt32)')                                 AS proxy_overhead_ms,
    status_code,

    input                                                          AS request_body,
    output                                                          AS response_body,
    error_message,

    trace_id,
    parent_event_id                                                AS span_id,
    prompt_version_id,
    provider_key_id,

    user_id,
    session_id,

    -- The four columns added by migration 006 — now passed through.
    flags,
    response_flags,
    has_security_flags,
    truncated,

    ''                                                              AS service_tier,

    created_at
FROM events
WHERE event_type = 'generation';
