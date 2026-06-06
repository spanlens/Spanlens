-- 008_create_trace_and_span_views.sql
-- Phase 5.1 Stage 3 / PR-7a — projection views for trace + span rows.
--
-- The legacy `/api/v1/traces` handler reads from Supabase `traces`
-- and `spans` tables. To flip it to read from the unified `events`
-- table, we expose two views that match the Postgres column shape
-- exactly so the handler can do a single FROM-clause substitution.
--
-- WHY two views and not one: the dashboard renders traces as the
-- parent row (list + detail header) and spans as the nested tree
-- in the detail view. Two views keep each SELECT cheap (each filters
-- on event_type at the view definition, so the engine pushes the
-- predicate down) and the handler code stays close to today's shape.
--
-- WHY hardcoded literal defaults for columns events doesn't carry:
--   • external_trace_id / external_span_id / external_parent_span_id
--     — populated by OTLP ingest in Postgres. Until events has them
--     as first-class columns, we surface NULL.
--   • span_count / total_tokens / total_cost_usd on traces — these
--     are pre-aggregated in Postgres; the events shape would need a
--     subquery per row. Stage 3 returns them computed at SELECT
--     time via a single GROUP BY (handler responsibility), so the
--     view returns 0 placeholders.
--   • request_id on spans — references the legacy `requests` table.
--     We expose the parent event's id as a stand-in.
--
-- IDEMPOTENT: CREATE VIEW IF NOT EXISTS.

CREATE VIEW IF NOT EXISTS traces_view AS
SELECT
    event_id                                    AS id,
    organization_id,
    project_id,
    api_key_id,
    name,
    coalesce(metadata['status'], '')            AS status,
    start_time                                  AS started_at,
    end_time                                    AS ended_at,
    duration_ms,
    error_message,
    CAST(NULL, 'Nullable(String)')              AS external_trace_id,
    -- These three are pre-aggregated on the Postgres traces table.
    -- The handler re-derives them per-row from spans when serving
    -- list responses (cheap LEFT JOIN ON trace_id under 1k traces).
    CAST(0, 'UInt32')                           AS span_count,
    CAST(0, 'UInt32')                           AS total_tokens,
    CAST(0, 'Decimal(18, 8)')                   AS total_cost_usd,
    metadata,
    created_at,
    created_at                                  AS updated_at
FROM events
WHERE event_type = 'trace';

CREATE VIEW IF NOT EXISTS spans_view AS
SELECT
    event_id                                    AS id,
    trace_id,
    parent_event_id                             AS parent_span_id,
    organization_id,
    name,
    coalesce(metadata['span_type'], '')         AS span_type,
    coalesce(metadata['status'], '')            AS status,
    start_time                                  AS started_at,
    end_time                                    AS ended_at,
    duration_ms,
    input,
    output,
    metadata,
    error_message,
    -- `request_id` references the Postgres requests table; events
    -- carries the parent context via parent_event_id already.
    CAST(NULL, 'Nullable(UUID)')                AS request_id,
    toUInt32OrZero(toString(usage_details['prompt_tokens']))     AS prompt_tokens,
    toUInt32OrZero(toString(usage_details['completion_tokens'])) AS completion_tokens,
    toUInt32OrZero(toString(usage_details['total_tokens']))      AS total_tokens,
    total_cost_usd                              AS cost_usd,
    CAST(NULL, 'Nullable(String)')              AS external_span_id,
    CAST(NULL, 'Nullable(String)')              AS external_parent_span_id,
    created_at
FROM events
WHERE event_type = 'span';
