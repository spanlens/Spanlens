-- Migration: webhook_deliveries dead-letter marking.
--
-- Before this, a delivery that exhausted its 5 retry attempts (or whose
-- webhook was deleted/disabled, or whose payload row was lost) stayed in
-- webhook_deliveries with status='failed' + next_retry_at=NULL, indistinguishable
-- from a delivery that is merely between retries. There was no way to count
-- permanently-dead deliveries, page on them, or inspect them after the fact —
-- a webhook endpoint down for >~1h would silently drop every event.
--
-- This adds an explicit dead-letter marker (additive, nullable — existing rows
-- stay NULL = not dead-lettered). retryFailedWebhooks() stamps dlq_at + a
-- reason when it gives up, and a cheap partial index makes "how many are dead"
-- a covered count for /health/deep and the operator alert.

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS dlq_at TIMESTAMPTZ;

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS dlq_reason TEXT
    CHECK (dlq_reason IN ('exhausted', 'webhook_deleted', 'payload_missing'));

-- "How many dead-lettered deliveries" — exact shape of the health metric +
-- alert query. Shrinks to the dead set only (live deliveries are excluded).
CREATE INDEX IF NOT EXISTS webhook_deliveries_dlq_idx
  ON webhook_deliveries (dlq_at)
  WHERE dlq_at IS NOT NULL;

COMMENT ON COLUMN webhook_deliveries.dlq_at IS
  'When the delivery was permanently given up on (dead-lettered). NULL = still live (delivered or retryable).';
COMMENT ON COLUMN webhook_deliveries.dlq_reason IS
  'Why it was dead-lettered: exhausted (hit MAX_ATTEMPTS), webhook_deleted (endpoint removed/disabled), or payload_missing.';
