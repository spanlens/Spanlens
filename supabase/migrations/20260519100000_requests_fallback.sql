-- ─────────────────────────────────────────────────────────────────────────────
-- requests_fallback — emergency queue for proxy request logs that couldn't
-- reach ClickHouse.
--
-- WHY: After the 2026-05-16 migration of `requests` to ClickHouse, every
-- INSERT goes to a single ClickHouse Cloud Development tier instance. If
-- that instance is unreachable (network blip, planned maintenance, cold
-- start on a Development tier auto-pause), the fire-and-forget INSERT in
-- logger.ts currently catches the error and prints to console — the row
-- is gone. We need a backstop so customer billing + dashboard data don't
-- silently lose entries during transient ClickHouse outages.
--
-- DESIGN
--   • Single Supabase table whose columns mirror the ClickHouse `requests`
--     shape closely enough that a cron job can replay rows back into CH.
--   • `payload jsonb` holds the full INSERT body (every column ClickHouse
--     expects) so the replay job is just "POST this row to ClickHouse",
--     no per-column code drift between this migration and ClickHouse
--     schema changes.
--   • `retry_count` lets the cron back off / give up on pathologic rows.
--   • RLS forbids client access — only `service_role` (server) writes.
--   • created_at index supports FIFO replay + a TTL cron.
--
-- USAGE
--   On CH insert failure → INSERT into requests_fallback with the payload.
--   Cron `/cron/replay-fallback` (every 5 min) replays rows in batches,
--   deleting on success and incrementing retry_count on failure.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS requests_fallback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The full ClickHouse INSERT row, exactly as logger.ts would have sent it.
  -- Keeping it opaque means we don't need a column-by-column DDL update
  -- whenever the ClickHouse schema evolves.
  payload       JSONB NOT NULL,
  -- Surfaced for cheap cron filtering — kept in sync with payload->>'organization_id'.
  organization_id UUID,
  -- Bumped by the replay cron each time it retries this row. After 7 days
  -- or 100 retries the cron archives + deletes (see cron.ts).
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_retry_at TIMESTAMPTZ
);

-- FIFO replay + retention cleanup both want a chronological index.
CREATE INDEX IF NOT EXISTS idx_requests_fallback_created_at
  ON requests_fallback (created_at);

-- Cron can scan for "stalled" rows (high retry count) cheaply.
CREATE INDEX IF NOT EXISTS idx_requests_fallback_retry_count
  ON requests_fallback (retry_count)
  WHERE retry_count > 0;

ALTER TABLE requests_fallback ENABLE ROW LEVEL SECURITY;
-- No policies = client access blocked. Server uses supabaseAdmin (service_role)
-- which bypasses RLS by design.

COMMENT ON TABLE requests_fallback IS
  'Backstop queue for proxy request logs that ClickHouse rejected. Populated by lib/logger.ts catch path; drained by cron /replay-fallback. See P2.6.';
COMMENT ON COLUMN requests_fallback.payload IS
  'The full ClickHouse INSERT row (JSONEachRow shape). Opaque so this table does not need migrations when the CH schema changes.';
