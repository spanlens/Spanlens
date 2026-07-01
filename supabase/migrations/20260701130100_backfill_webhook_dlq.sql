-- One-time backfill: mark webhook_deliveries that already exhausted their
-- retries BEFORE 20260701130000_webhook_deliveries_dlq.sql shipped.
--
-- Those rows reached attempt_count = MAX_ATTEMPTS (5) with next_retry_at = NULL
-- under the old exhaustion path, and retryFailedWebhooks() only ever re-fetches
-- rows with attempt_count < MAX_ATTEMPTS. So they can never reach the new code
-- that stamps dlq_at/dlq_reason. Without this backfill, /health/deep dlq_count,
-- alertOnWebhookDlq, and the DR runbook's `WHERE dlq_at IS NOT NULL` query would
-- permanently under-count the historical dead-letter set.
--
-- Idempotent: only touches rows not already marked (dlq_at IS NULL). MAX_ATTEMPTS
-- (5) is hardcoded to match the constant in apps/server/src/lib/webhook-dispatch.ts.

UPDATE webhook_deliveries
SET dlq_at = now(),
    dlq_reason = 'exhausted'
WHERE dlq_at IS NULL
  AND status = 'failed'
  AND next_retry_at IS NULL
  AND attempt_count >= 5;
