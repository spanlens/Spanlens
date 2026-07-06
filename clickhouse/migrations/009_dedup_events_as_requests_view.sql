-- 009_dedup_events_as_requests_view.sql
-- Phase 5.1 — dedup the `events_as_requests` view.
--
-- WHY: `events` is a plain MergeTree (see 004) with no ReplacingMergeTree
-- collapse. The live dual-write (writeRequestAsEvent: event_id = requests.id)
-- and the requests→events backfill (mapRequestToEventRow, same id) both write a
-- row for the same request, so any request in the dual-write/backfill overlap
-- window exists TWICE in `events` with the SAME event_id. The stats pipeline
-- reads this view, so sum(cost_usd) / count() were double-counting for orgs on
-- the events read path. The requests-list path (selectGenerationsAsRequests /
-- countGenerations) is deduped in TS; this migration is its view counterpart so
-- both read paths agree.
--
-- HOW: `LIMIT 1 BY event_id` keeps one row per event_id. Duplicate rows are
-- byte-identical, so which one survives does not matter and no ORDER BY is
-- needed. event_id is globally unique, so dedup-then-filter and
-- filter-then-dedup produce the same rows for any org/time predicate a caller
-- adds on top of the view.
--
-- IDEMPOTENT: DROP IF EXISTS + CREATE. Metadata-only; never touches rows.
-- ORDER: runs after 007 (lexical order), inheriting 006's columns.
--
-- ⚠ VERIFY BEFORE FLIPPING read_from_events: this cannot be exercised without a
-- real ClickHouse (unit tests only assert generated SQL). Before enabling the
-- flag for any org, smoke-test on a real cluster that (a) stats totals match
-- the `requests` table for the same window and (b) the whole-table LIMIT BY
-- dedup is acceptable perf. The scan-then-filter shape is a known cost; the
-- long-term fix is a ReplacingMergeTree(event_id) or an outbox (CLAUDE.md
-- gotcha #23), which supersedes this stopgap.

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

    flags,
    response_flags,
    has_security_flags,
    truncated,

    ''                                                             AS service_tier,

    created_at
FROM events
WHERE event_type = 'generation'
LIMIT 1 BY event_id;
