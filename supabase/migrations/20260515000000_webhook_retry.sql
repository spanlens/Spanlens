-- Migration: webhook_retry
--
-- Adds columns needed to retry failed webhook deliveries with exponential
-- back-off:
--   payload        — stores the signed payload so the retry can re-send it
--   attempt_count  — how many times delivery has been attempted
--   next_retry_at  — when the next retry should run (NULL = done / succeeded)
--
-- The cron endpoint /cron/retry-webhooks queries on next_retry_at and
-- re-dispatches deliveries that are past-due and have attempt_count < 5.

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS payload        JSONB,
  ADD COLUMN IF NOT EXISTS attempt_count  INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_retry_at  TIMESTAMPTZ;

-- Sparse index: only rows that are pending retry (failed + has a retry_at).
CREATE INDEX IF NOT EXISTS webhook_deliveries_retry_idx
  ON webhook_deliveries (next_retry_at)
  WHERE next_retry_at IS NOT NULL AND status = 'failed';
