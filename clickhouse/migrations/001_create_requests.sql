-- 001_create_requests.sql
-- The `requests` table mirrors the Supabase schema this is migrating away from,
-- but is restructured for columnar storage + high-volume append-only workloads.
--
-- Design decisions (see docs/plans/clickhouse-migration.md §5 for full rationale):
--   * MergeTree engine — standard, optimal for append-only data.
--   * PARTITION BY toYYYYMM — monthly partitions accelerate range scans and
--     enable cheap retention via DROP PARTITION.
--   * ORDER BY (organization_id, project_id, created_at, id) — multitenant
--     isolation + time-range queries + stable sort all benefit from this prefix.
--   * LowCardinality for provider/model — finite value set, maximal compression.
--   * Body columns are ZSTD(3) compressed strings, not JSON (JSON type is still
--     experimental in ClickHouse). 3–10x smaller than Supabase JSONB.
--   * TTL 365 days — matches the longest non-Enterprise plan (Team). Free/Pro
--     retention is enforced at query time by the API middleware. Enterprise
--     uses a separate table/partition strategy decided later.
CREATE TABLE IF NOT EXISTS requests (
    id                  UUID,
    organization_id     UUID,
    project_id          UUID,
    api_key_id          Nullable(UUID),

    provider            LowCardinality(String),
    model               LowCardinality(String),

    prompt_tokens       UInt32 DEFAULT 0,
    completion_tokens   UInt32 DEFAULT 0,
    total_tokens        UInt32 DEFAULT 0,
    cache_read_tokens   UInt32 DEFAULT 0,
    cache_write_tokens  UInt32 DEFAULT 0,

    cost_usd            Nullable(Decimal(18, 8)),
    latency_ms          UInt32 DEFAULT 0,
    proxy_overhead_ms   Nullable(UInt32),
    status_code         UInt16 DEFAULT 0,

    request_body        String DEFAULT '' CODEC(ZSTD(3)),
    response_body       String DEFAULT '' CODEC(ZSTD(3)),
    error_message       Nullable(String),

    trace_id            Nullable(UUID),
    span_id             Nullable(UUID),
    prompt_version_id   Nullable(UUID),
    provider_key_id     Nullable(UUID),

    user_id             Nullable(String),
    session_id          Nullable(String),

    flags               String DEFAULT '[]',
    response_flags      String DEFAULT '{}',
    has_security_flags  Bool DEFAULT false,

    created_at          DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (organization_id, project_id, created_at, id)
TTL toDateTime(created_at) + INTERVAL 365 DAY;
