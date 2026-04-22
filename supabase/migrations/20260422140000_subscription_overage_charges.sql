-- Migration: subscription_overage_charges
-- Idempotency table for Paddle usage-based overage billing.
--
-- The daily cron-report-usage-overage job decides, at the end of each
-- billing period, to issue a one-time charge for the overage amount via
-- POST /subscriptions/{id}/charge. The UNIQUE (subscription_id, period_end)
-- constraint here is the core guard against double-charging.
--
-- Intended write pattern:
--   1. INSERT with status='pending' before calling Paddle
--   2. Call POST /subscriptions/{id}/charge
--   3. UPDATE with status='charged' + paddle_response on success,
--      or status='error' + error_message on failure
--
-- On cron re-run after a crash, the pending/charged/error row already
-- exists — SELECT returns it, the job skips it. Safer to under-bill
-- than to double-charge: an operator can flip a stuck `pending` or
-- `error` row to `retry` manually.

CREATE TABLE subscription_overage_charges (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id         UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  period_start            TIMESTAMPTZ NOT NULL,
  period_end              TIMESTAMPTZ NOT NULL,
  overage_requests        INTEGER NOT NULL,
  overage_quantity        INTEGER NOT NULL, -- usually ceil(overage_requests / 1000)
  price_id                TEXT NOT NULL,
  status                  TEXT NOT NULL
                            DEFAULT 'pending'
                            CHECK (status IN ('pending', 'charged', 'error', 'retry')),
  paddle_response         JSONB,
  error_message           TEXT,
  charged_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ,
  UNIQUE (subscription_id, period_end)
);

CREATE INDEX subscription_overage_charges_status_idx
  ON subscription_overage_charges (status)
  WHERE status IN ('pending', 'error', 'retry');

ALTER TABLE subscription_overage_charges ENABLE ROW LEVEL SECURITY;

-- Dashboard read: org members can see their own overage history.
CREATE POLICY "overage_select" ON subscription_overage_charges
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = subscription_overage_charges.subscription_id
        AND is_org_member(s.organization_id)
    )
  );

-- Writes go through service_role only — no INSERT/UPDATE/DELETE policies
-- means the anon/authenticated roles have no write access.
