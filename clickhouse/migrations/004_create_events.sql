-- 004_create_events.sql
-- Unified event store. Stage 1 of Phase 5.1.
--
-- WHY a separate `events` table when we already have `requests`:
--
--   * `requests` is one row per LLM call. A user-facing "trace" is
--     reconstructed by joining requests + traces + spans across
--     ClickHouse and Postgres. Dashboards do this join on every
--     pageview.
--   * Langfuse (and PostHog, and Datadog APM) found that a single
--     append-only `events` table — where a trace, span, and LLM
--     generation are all variants of the same row shape — is far
--     simpler to query and roughly 3x faster than the join.
--   * `usage_details` as a Map lets future token kinds (vision,
--     reasoning, cache-write tiers) land without a column migration.
--   * Same for `cost_details` — different providers split cost
--     differently (input/output/cache/reasoning) and a Map keeps
--     the per-call breakdown without a wide table.
--
-- ROLLOUT (do NOT cut over reads until all 3 stages land):
--
--   Stage 1 (this PR): create the table + dual-write from logger
--     and ingest. Reads still come from `requests` / Postgres
--     traces. Risk-controlled — events being broken doesn't break
--     production.
--   Stage 2: background-migration backfill 6 months of requests
--     into events.
--   Stage 3: feature-flag reads per dashboard route. Roll back to
--     `requests` if a single route mismatches.
--
-- The schema deliberately mirrors `requests` field naming where it
-- can so the backfill is a straight SELECT … INSERT.

CREATE TABLE IF NOT EXISTS events (
    -- Identity. event_id is per-row; trace_id groups by trace;
    -- parent_event_id chains spans. For type='trace' the trace_id
    -- equals event_id and parent_event_id is empty.
    event_id            UUID,
    trace_id            UUID,
    parent_event_id     Nullable(UUID),

    -- Discriminator. We accept a wider value set than today (just
    -- 'generation', 'trace', 'span') so future event kinds (eval
    -- run, embedding, tool call, observation) don't need a column
    -- migration. LowCardinality keeps the dictionary tight.
    event_type          LowCardinality(String),

    -- Tenant + project + caller key. organization_id is the first
    -- sort key so single-tenant scans hit one (or a few) parts.
    organization_id     UUID,
    project_id          UUID,
    api_key_id          Nullable(UUID),

    -- Human label ("openai.chat.completions" for LLM calls,
    -- "trace_name" for traces, span name for spans).
    name                LowCardinality(String),

    -- Provider + model. Empty for non-LLM events.
    provider            LowCardinality(String) DEFAULT '',
    model               LowCardinality(String) DEFAULT '',

    -- Per-event start + end. duration_ms is denormalised so range
    -- aggregations don't need a per-row computation.
    start_time          DateTime64(3, 'UTC') DEFAULT now64(3),
    end_time            Nullable(DateTime64(3, 'UTC')),
    duration_ms         Nullable(UInt32),

    -- Body columns. ZSTD-compressed strings, same trade-off as
    -- requests. Empty string when logBody=meta/none.
    input               String DEFAULT '' CODEC(ZSTD(3)),
    output              String DEFAULT '' CODEC(ZSTD(3)),

    -- Open-ended numeric details. Adding a new key (e.g.
    -- "vision_input_tokens") doesn't need a column migration —
    -- we just start writing the new key and every dashboard query
    -- that wants it does a single map lookup.
    usage_details       Map(String, UInt64),
    cost_details        Map(String, Decimal(18, 8)),

    -- Total cost flattened out for the common "spend over time" query
    -- — saves the dashboard from summing the map on every row.
    total_cost_usd      Nullable(Decimal(18, 8)),
    total_tokens        UInt32 DEFAULT 0,

    -- HTTP-style status for LLM calls (matches `requests.status_code`).
    -- 0 for non-LLM events.
    status_code         UInt16 DEFAULT 0,
    error_message       Nullable(String),

    -- Free-form tags. String values only so it stays cheap; complex
    -- metadata can live in input/output JSON.
    metadata            Map(String, String),

    -- End-user / session identifiers — same semantics as
    -- `requests.user_id` / `session_id`.
    user_id             Nullable(String),
    session_id          Nullable(String),

    -- Optional cross-references the dashboard already cares about.
    prompt_version_id   Nullable(UUID),
    provider_key_id     Nullable(UUID),

    created_at          DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
-- Same prefix as requests (organization_id, project_id, created_at)
-- so multitenant range scans stay fast. trace_id last so per-trace
-- "show me all spans" queries hit the right primary-key skip.
ORDER BY (organization_id, project_id, created_at, trace_id, event_id)
-- Match requests' 365d TTL so we don't accidentally retain events
-- longer than the source LLM call.
TTL toDateTime(created_at) + INTERVAL 365 DAY;
