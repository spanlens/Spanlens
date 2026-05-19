-- ─────────────────────────────────────────────────────────────────────────────
-- subscriptions.past_due_since — tracks when a subscription first entered
-- the `past_due` status so the auto-downgrade cron knows how long the
-- customer has been delinquent.
--
-- WHY: Paddle reports `subscription.status = 'past_due'` indefinitely after
-- payment failure. Without recording the FIRST transition we couldn't tell
-- "failed yesterday" from "failed 30 days ago". The downgrade cron uses
-- `now() - past_due_since >= 7d` to trigger free fallback.
--
-- BEHAVIOR:
--   • Set to now() in the webhook ONLY on the transition into past_due
--     (idempotent — re-receiving the same past_due event doesn't reset it)
--   • Cleared (set NULL) when status returns to active/trialing
--   • Carries through canceled status so we keep history for analytics
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;

COMMENT ON COLUMN subscriptions.past_due_since IS
  'Timestamp of the FIRST transition into past_due. Used by cron /check-past-due-downgrades. NULL = subscription has not been delinquent (or has recovered).';

-- Partial index for the daily cron — only past_due rows are scanned.
CREATE INDEX IF NOT EXISTS idx_subscriptions_past_due_since
  ON subscriptions (past_due_since)
  WHERE past_due_since IS NOT NULL;
