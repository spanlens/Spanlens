-- 005_create_events_as_requests_view.sql
-- Phase 5.1 Stage 3 — projection view that exposes the `events` table
-- in the column shape the legacy `stats-queries.ts` already expects from
-- `requests`.
--
-- WHY a VIEW rather than per-call CTEs:
--   The stats pipeline has nine separate functions, each with its own
--   hand-rolled SQL string and 'FROM requests' baked in. Wrapping every
--   query in a CTE would touch every function and bloat the SQL by
--   ~30 lines per call site. A view keeps the per-function diff to a
--   single 'FROM requests' → 'FROM events_as_requests' string swap,
--   and reuses ClickHouse's query planner on the underlying table.
--
-- WHY column-by-column aliasing:
--   `events` is the canonical append-only event schema with
--   `total_cost_usd`, `duration_ms`, `usage_details Map`, `input`,
--   `output`. The legacy stats queries reference the historical
--   names. The view bridges the two so the feature flag flip in
--   `lib/stats-source.ts` is a one-line behaviour change.
--
-- WHY hard-coded literals for flags/response_flags/has_security_flags/
-- truncated:
--   These four columns live on `requests` but never made it onto
--   `events` (gap to be closed by a follow-up migration). The legacy
--   SecuritySummary and truncated-row stats need them, so the view
--   returns neutral defaults. Once `events` carries them natively
--   the literals are swapped for the real columns.
--
-- IDEMPOTENT: CREATE VIEW IF NOT EXISTS. Drop + recreate by hand if
-- the projection changes.

CREATE VIEW IF NOT EXISTS events_as_requests AS
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

    '[]'                                                            AS flags,
    '{}'                                                            AS response_flags,
    CAST(0, 'Bool')                                                 AS has_security_flags,
    CAST(0, 'UInt8')                                                AS truncated,
    ''                                                              AS service_tier,

    created_at
FROM events
WHERE event_type = 'generation';
