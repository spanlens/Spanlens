-- ─────────────────────────────────────────────────────────────────────────────
-- events_fallback — emergency queue for ClickHouse `events` shadow writes
-- that couldn't reach ClickHouse.
--
-- WHY: Phase 5.1 Stage 3 made the dashboard read from the unified `events`
-- table for every route. Stage 4 (Postgres traces/spans deprecate) needs
-- `events` to become the single source of truth for traces and spans, so
-- any in-flight write that fails (ClickHouse Cloud dev-tier auto-pause,
-- transient network blip) must NOT be lost. `lib/events-writer.ts` currently
-- swallows failures and writes them to console — fine in shadow-write mode
-- (Postgres still has the row), insufficient once Postgres is removed.
--
-- DESIGN — mirrors `requests_fallback` (P2.6) on purpose:
--   • Single Supabase table whose `payload jsonb` holds the full ClickHouse
--     INSERT row exactly as events-writer would have sent it. Schema-opaque
--     so this migration doesn't have to follow every `events` column add.
--   • `event_type` surfaced as a separate column so a future operator
--     dashboard can show queue depth per event_type (generation / trace /
--     span) without parsing payload.
--   • `retry_count` + `last_error` for cron back-off / poison-row detection.
--   • RLS forbids client access — only `service_role` (server) writes.
--   • Indexes on (created_at) for FIFO + (retry_count) for stalled-row sweep.
--
-- USAGE
--   On ClickHouse insert failure → INSERT into events_fallback with the
--   payload. The same `/cron/replay-fallback` (every 5 min) drains both
--   `requests_fallback` AND `events_fallback` so a single endpoint handles
--   both backstops.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events_fallback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The full ClickHouse INSERT row, exactly as events-writer.ts would have
  -- sent it. Opaque so this table doesn't need DDL changes when the
  -- `events` ClickHouse schema evolves.
  payload         JSONB NOT NULL,
  -- Surfaced for cheap cron filtering and queue-depth-per-type dashboards.
  -- Kept in sync with payload->>'event_type'.
  event_type      TEXT NOT NULL,
  -- Bumped by the replay cron each retry. After 7 days OR 100 retries the
  -- cron expires the row (poison payload poisoning the queue).
  retry_count     INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_retry_at   TIMESTAMPTZ
);

-- FIFO replay + retention cleanup both want a chronological index.
CREATE INDEX IF NOT EXISTS idx_events_fallback_created_at
  ON events_fallback (created_at);

-- Cheap scan for "stalled" rows.
CREATE INDEX IF NOT EXISTS idx_events_fallback_retry_count
  ON events_fallback (retry_count)
  WHERE retry_count > 0;

-- Queue-depth-per-event_type lookups (admin UI / metrics).
CREATE INDEX IF NOT EXISTS idx_events_fallback_event_type
  ON events_fallback (event_type);

ALTER TABLE events_fallback ENABLE ROW LEVEL SECURITY;
-- No policies = client access blocked. Server uses supabaseAdmin (service_role)
-- which bypasses RLS by design.

COMMENT ON TABLE events_fallback IS
  'Backstop queue for ClickHouse events shadow writes that failed. Populated by lib/events-writer.ts catch path; drained by cron /replay-fallback alongside requests_fallback. Stage 4 prerequisite — events becomes single source of truth.';
COMMENT ON COLUMN events_fallback.payload IS
  'The full ClickHouse events INSERT row (JSONEachRow shape). Opaque so this table does not need migrations when the events CH schema changes.';
COMMENT ON COLUMN events_fallback.event_type IS
  'generation | trace | span. Mirrors payload->>event_type for cheap filtering.';
