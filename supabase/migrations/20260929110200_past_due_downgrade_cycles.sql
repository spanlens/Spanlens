-- ─────────────────────────────────────────────────────────────────────────────
-- Past-due auto-downgrade: per-cycle dedupe, email outbox, atomic downgrade.
--
-- WHY (quality audit 2026-09-28, C3.2):
--   1. billing_downgrade_notifications was UNIQUE (subscription_id, stage).
--      A subscription that went past_due, was downgraded, paid, and went
--      past_due AGAIN hit 23505 on every stage, so the second delinquency
--      was never warned about or downgraded. The file header promised
--      "a re-upgrade starts fresh"; the constraint made that impossible.
--   2. The cron INSERTed the marker first and then ran the org UPDATE, the
--      subscriptions UPDATE and the audit INSERT without reading { error }.
--      A failed write still counted as "downgraded", and the marker made
--      sure it was never retried. Email sends had the same shape: marker
--      first, so a failed send was never re-sent.
--   3. The downgrade did not re-check that the subscription was still past
--      due, and forced 'free' even when the org had another live
--      subscription.
--
-- WHAT:
--   * cycle_started_at (= subscriptions.past_due_since of the cycle) joins
--     the dedupe key: UNIQUE NULLS NOT DISTINCT (subscription_id, stage,
--     cycle_started_at). Legacy rows keep NULL and stay unique among
--     themselves; rows of the current cycle are backfilled so the deploy does
--     not re-send a warning that already went out.
--   * The table doubles as an email outbox: status pending -> sent | skipped
--     | failed, with attempts / last_attempt_at / last_error / sent_at.
--     Legacy rows become 'sent' (they were attempted by the old code); new
--     rows default to 'pending' and are marked sent only after the provider
--     accepted the email.
--   * apply_past_due_downgrade() does the state change in one transaction:
--     compare-and-set on (id, past_due_since, status IN past_due/paused),
--     recompute the org plan from live subscriptions, write the audit row,
--     and queue the 'downgraded' email only when the org actually lands on
--     'free'. If the row changed underneath (recovered, canceled, new
--     cycle) it returns 'stale' and changes nothing.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.billing_downgrade_notifications
  ADD COLUMN IF NOT EXISTS cycle_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS attempts         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error       TEXT,
  ADD COLUMN IF NOT EXISTS sent_at          TIMESTAMPTZ;

-- Existing rows were added with DEFAULT 'sent' above; from here on a new
-- marker is an unsent outbox entry.
ALTER TABLE public.billing_downgrade_notifications
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.billing_downgrade_notifications
  DROP CONSTRAINT IF EXISTS billing_downgrade_notifications_status_check;
ALTER TABLE public.billing_downgrade_notifications
  ADD CONSTRAINT billing_downgrade_notifications_status_check
  CHECK (status IN ('pending', 'sent', 'skipped', 'failed'));

-- Legacy rows the old code attempted: give them a sent_at for audit.
UPDATE public.billing_downgrade_notifications
   SET sent_at = created_at
 WHERE status = 'sent' AND sent_at IS NULL;

-- Attach markers of the CURRENT delinquency cycle to that cycle, so the new
-- per-cycle key still dedupes against what was already sent.
UPDATE public.billing_downgrade_notifications n
   SET cycle_started_at = s.past_due_since
  FROM public.subscriptions s
 WHERE n.subscription_id = s.id
   AND n.cycle_started_at IS NULL
   AND s.past_due_since IS NOT NULL
   AND n.created_at >= s.past_due_since;

ALTER TABLE public.billing_downgrade_notifications
  DROP CONSTRAINT IF EXISTS billing_downgrade_notifications_cycle_key;
ALTER TABLE public.billing_downgrade_notifications
  ADD CONSTRAINT billing_downgrade_notifications_cycle_key
  UNIQUE NULLS NOT DISTINCT (subscription_id, stage, cycle_started_at);

ALTER TABLE public.billing_downgrade_notifications
  DROP CONSTRAINT IF EXISTS billing_downgrade_notifications_subscription_id_stage_key;

CREATE INDEX IF NOT EXISTS idx_billing_downgrade_notifications_pending
  ON public.billing_downgrade_notifications (created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.billing_downgrade_notifications IS
  'Per-cycle idempotency + email outbox for the past-due downgrade cron. UNIQUE NULLS NOT DISTINCT (subscription_id, stage, cycle_started_at); cycle_started_at is the subscription''s past_due_since for that delinquency cycle. status pending -> sent | skipped | failed.';

CREATE OR REPLACE FUNCTION public.apply_past_due_downgrade(
  p_subscription_id uuid,
  p_past_due_since timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_paddle_subscription_id text;
  v_from_plan text;
  v_to_plan text;
  v_email_queued boolean := false;
BEGIN
  SELECT organization_id INTO v_org FROM public.subscriptions WHERE id = p_subscription_id;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('outcome', 'stale');
  END IF;

  -- Same lock order as apply_paddle_subscription_event: org, then sub.
  SELECT plan INTO v_from_plan FROM public.organizations WHERE id = v_org FOR UPDATE;

  -- Compare-and-set: only the cycle the cron looked at, only while it is
  -- still delinquent. Closing the cycle is what stops the next run from
  -- downgrading again.
  UPDATE public.subscriptions
     SET past_due_since = NULL
   WHERE id = p_subscription_id
     AND past_due_since = p_past_due_since
     AND status IN ('past_due', 'paused')
  RETURNING paddle_subscription_id INTO v_paddle_subscription_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'stale', 'organization_id', v_org);
  END IF;

  -- Another live subscription keeps its plan; otherwise the org is free.
  v_to_plan := public.org_plan_from_live_subscriptions(v_org, NULL);
  UPDATE public.organizations SET plan = v_to_plan WHERE id = v_org;

  INSERT INTO public.audit_logs (
    organization_id, user_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_org, NULL, 'billing.plan.auto_downgrade', 'organization', v_org::text,
    jsonb_build_object(
      'reason', 'past_due_7_days',
      'past_due_since', p_past_due_since,
      'paddle_subscription_id', v_paddle_subscription_id,
      'from_plan', v_from_plan,
      'to_plan', v_to_plan
    )
  );

  IF v_to_plan = 'free' AND v_from_plan IS DISTINCT FROM 'free' THEN
    INSERT INTO public.billing_downgrade_notifications (subscription_id, stage, cycle_started_at)
    VALUES (p_subscription_id, 'downgraded', p_past_due_since)
    ON CONFLICT DO NOTHING;
    v_email_queued := true;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'downgraded',
    'organization_id', v_org,
    'from_plan', v_from_plan,
    'to_plan', v_to_plan,
    'email_queued', v_email_queued
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_past_due_downgrade(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_past_due_downgrade(uuid, timestamptz) TO service_role;
