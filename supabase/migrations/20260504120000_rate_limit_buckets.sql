-- Rate-limit sliding-window buckets (per-minute granularity).
--
-- Each row tracks how many requests a given key has made in a
-- specific 1-minute window ("YYYY-MM-DDTHH:MM" UTC string).
--
-- Reads and writes are done via the check_rate_limit() RPC which
-- performs an atomic INSERT ... ON CONFLICT DO UPDATE so concurrent
-- requests never miss each other's counts.
--
-- Rows older than 10 minutes are cleaned up by the existing
-- prune-logs cron. The table never grows large because windows expire quickly.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key          TEXT        NOT NULL,
  window_key   TEXT        NOT NULL, -- "YYYY-MM-DDTHH:MM" UTC
  count        INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, window_key)
);

-- Index to speed up cleanup queries
CREATE INDEX IF NOT EXISTS rate_limit_buckets_created_at_idx
  ON rate_limit_buckets (created_at);

-- Service-role only — no public access needed
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- ── RPC: atomic increment + limit check ──────────────────────────
-- Returns TRUE  → request is within the limit (allowed)
-- Returns FALSE → request exceeded the limit (block with 429)
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key        TEXT,
  p_window_key TEXT,
  p_limit      INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO rate_limit_buckets (key, window_key, count)
  VALUES (p_key, p_window_key, 1)
  ON CONFLICT (key, window_key)
  DO UPDATE SET count = rate_limit_buckets.count + 1
  RETURNING rate_limit_buckets.count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

-- ── Cleanup helper (called by prune-logs cron) ───────────────────
-- Deletes buckets older than 10 minutes to keep the table tiny.
CREATE OR REPLACE FUNCTION prune_rate_limit_buckets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM rate_limit_buckets
  WHERE created_at < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;
