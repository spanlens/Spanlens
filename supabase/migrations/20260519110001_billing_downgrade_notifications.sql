-- ─────────────────────────────────────────────────────────────────────────────
-- billing_downgrade_notifications — idempotency table for the P2.7 cron.
--
-- The cron sends D-3, D-1, and final downgrade emails. Vercel cron is
-- at-least-once, so we need a way to dedupe a re-run. UNIQUE on
-- (subscription_id, stage) lets the cron INSERT-first and treat a
-- 23505 (unique_violation) as "already done — skip this row".
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_downgrade_notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id   UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  -- 'warning-d3' | 'warning-d1' | 'downgraded'
  stage             TEXT NOT NULL CHECK (stage IN ('warning-d3', 'warning-d1', 'downgraded')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_billing_downgrade_notifications_subscription
  ON billing_downgrade_notifications (subscription_id);

ALTER TABLE billing_downgrade_notifications ENABLE ROW LEVEL SECURITY;
-- No policies: clients can't read this. Useful only to the server-side cron.

COMMENT ON TABLE billing_downgrade_notifications IS
  'Idempotency table for P2.7 past-due downgrade cron. (subscription_id, stage) UNIQUE prevents duplicate emails on cron retry.';
