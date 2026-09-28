-- Behavioural checks for the billing RPCs, run against a real Postgres.
--
-- The server's unit tests mock supabase-js, so they prove which RPC is called
-- with which arguments and how its { error } is handled. They cannot prove
-- what the SQL inside the function does: that the ordering guard rejects an
-- older event, that a canceled subscription leaves the org on the plan of a
-- sibling that is still live, that the downgrade CAS refuses a row that
-- recovered. This file does, with ASSERT, inside a transaction it rolls back.
--
-- Run after migrations are applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/billing-rpc-smoke.sql
-- Local check before the migrations are applied (shared DB, nothing persists):
--   BEGIN; \i <migrations...>; \i supabase/tests/billing-rpc-smoke.sql
-- (the inner BEGIN only warns; the final ROLLBACK undoes everything)

\set ON_ERROR_STOP on

\echo '── billing RPC smoke ──'

BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES (
  '00000000-0000-4000-8000-00000000b001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'billing-smoke@spanlens.test'
);

INSERT INTO public.organizations (id, name, owner_id, plan)
VALUES
  ('00000000-0000-4000-8000-00000000b0a0', 'billing-smoke-a', '00000000-0000-4000-8000-00000000b001', 'free'),
  ('00000000-0000-4000-8000-00000000b0b0', 'billing-smoke-b', '00000000-0000-4000-8000-00000000b001', 'free');

-- ── apply_paddle_subscription_event ─────────────────────────────────────────

-- 1. First event inserts the row and mirrors the plan + customer onto the org.
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'active', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_1","last_event_type":"subscription.created","occurred_at":"2026-09-01T00:00:00Z"}'
  );
  ASSERT (r->>'applied')::boolean, 'first event must apply';
  ASSERT r->>'org_plan' = 'starter', 'org plan must mirror the active subscription';
  ASSERT (SELECT plan FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000b0a0') = 'starter',
    'organizations.plan must be starter';
  ASSERT (SELECT paddle_customer_id FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000b0a0') = 'ctm_smoke_a',
    'organizations.paddle_customer_id must be written on active';
END $$;

-- 2. An OLDER event is skipped and changes nothing.
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'canceled', NULL, NULL, false,
    '{"last_event_id":"evt_0","last_event_type":"subscription.canceled","occurred_at":"2026-08-31T00:00:00Z"}'
  );
  ASSERT NOT (r->>'applied')::boolean, 'older event must be skipped';
  ASSERT (SELECT status FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a1') = 'active',
    'skipped event must not change status';
  ASSERT (SELECT metadata->>'occurred_at' FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a1')
    = '2026-09-01T00:00:00Z', 'skipped event must not move occurred_at backwards';
END $$;

-- 3. The SAME occurred_at is re-applied (a Paddle retry after a half failure).
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'active', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_1","last_event_type":"subscription.created","occurred_at":"2026-09-01T00:00:00Z"}'
  );
  ASSERT (r->>'applied')::boolean, 'an event with the stored occurred_at must re-apply';
END $$;

-- 4. A second live subscription with a higher tier lifts the org plan.
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a2', 'ctm_smoke_a', 'pri_team',
    'team', 'active', '2026-09-02T00:00:00Z', now() + interval '31 days', false,
    '{"last_event_id":"evt_2","last_event_type":"subscription.created","occurred_at":"2026-09-02T00:00:00Z"}'
  );
  ASSERT r->>'org_plan' = 'team', 'highest live tier must win';
END $$;

-- 5. Canceling one subscription keeps the org on its live sibling, not free.
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a2', 'ctm_smoke_a', 'pri_team',
    'team', 'canceled', NULL, NULL, false,
    '{"last_event_id":"evt_3","last_event_type":"subscription.canceled","occurred_at":"2026-09-03T00:00:00Z"}'
  );
  ASSERT (r->>'applied')::boolean, 'cancel must apply';
  ASSERT (SELECT plan FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000b0a0') = 'starter',
    'cancel must fall back to the live sibling plan, not free';
END $$;

-- 6. past_due opens a cycle and leaves the org plan alone.
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'past_due', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_4","last_event_type":"subscription.past_due","occurred_at":"2026-09-04T00:00:00Z"}'
  );
  ASSERT r->>'org_plan' IS NULL, 'past_due must not recompute the org plan';
  ASSERT (SELECT past_due_since FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a1') IS NOT NULL,
    'entering past_due must stamp past_due_since';
  ASSERT (SELECT plan FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000b0a0') = 'starter',
    'past_due must keep the paid plan during the grace period';
END $$;

-- 7. A repeated past_due event keeps the cycle start. After the cron closes
--    the cycle (past_due_since = NULL), a repeat does not reopen it.
DO $$
DECLARE
  v_before timestamptz;
BEGIN
  UPDATE public.subscriptions SET past_due_since = '2026-09-04T00:00:00Z'
   WHERE paddle_subscription_id = 'sub_smoke_a1';
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'past_due', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_5","last_event_type":"subscription.updated","occurred_at":"2026-09-05T00:00:00Z"}'
  );
  SELECT past_due_since INTO v_before FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a1';
  ASSERT v_before = '2026-09-04T00:00:00Z'::timestamptz, 'repeat past_due must keep the cycle start';

  UPDATE public.subscriptions SET past_due_since = NULL WHERE paddle_subscription_id = 'sub_smoke_a1';
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'past_due', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_6","last_event_type":"subscription.updated","occurred_at":"2026-09-06T00:00:00Z"}'
  );
  ASSERT (SELECT past_due_since FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a1') IS NULL,
    'a closed cycle must not be reopened by a repeated past_due';
END $$;

-- 8. Recovery clears past_due_since; the next failure opens a new cycle.
DO $$
BEGIN
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'active', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_7","last_event_type":"subscription.updated","occurred_at":"2026-09-07T00:00:00Z"}'
  );
  ASSERT (SELECT past_due_since FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a1') IS NULL,
    'recovery must clear past_due_since';
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'past_due', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_8","last_event_type":"subscription.past_due","occurred_at":"2026-09-08T00:00:00Z"}'
  );
  ASSERT (SELECT past_due_since FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a1') IS NOT NULL,
    'a failure after recovery must open a new cycle';
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'active', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_9","last_event_type":"subscription.updated","occurred_at":"2026-09-09T00:00:00Z"}'
  );
END $$;

-- 9. A stored occurred_at that does not parse never blocks later events.
DO $$
DECLARE r jsonb;
BEGIN
  UPDATE public.subscriptions SET metadata = '{"occurred_at":"not-a-date"}'
   WHERE paddle_subscription_id = 'sub_smoke_a1';
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'active', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_10","last_event_type":"subscription.updated","occurred_at":"2026-09-10T00:00:00Z"}'
  );
  ASSERT (r->>'applied')::boolean, 'unparsable stored timestamp must not block';
END $$;

-- 10. An unknown org raises, so the webhook answers 5xx instead of 200.
DO $$
BEGIN
  BEGIN
    PERFORM public.apply_paddle_subscription_event(
      '00000000-0000-4000-8000-00000000dead', 'sub_smoke_x', 'ctm_smoke_x', 'pri_starter',
      'starter', 'active', NULL, NULL, false, '{"occurred_at":"2026-09-01T00:00:00Z"}'
    );
    RAISE EXCEPTION 'expected an error for an unknown organization';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END $$;

-- ── apply_paddle_refund ─────────────────────────────────────────────────────

-- 11. A refund removes the refunded subscription's entitlement right away...
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_paddle_refund('00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1');
  ASSERT r->>'org_plan' = 'free', 'refund of the only live subscription must drop to free';
END $$;

-- 12. ...but keeps the org on another live subscription.
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a3', 'ctm_smoke_a', 'pri_team',
    'team', 'active', '2026-09-11T00:00:00Z', now() + interval '40 days', false,
    '{"last_event_id":"evt_11","last_event_type":"subscription.created","occurred_at":"2026-09-11T00:00:00Z"}'
  );
  r := public.apply_paddle_refund('00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1');
  ASSERT r->>'org_plan' = 'team', 'refund must keep a live sibling plan';
END $$;

-- ── billing_checkout_sessions ───────────────────────────────────────────────

-- 13. One creating/open checkout per org; finished ones do not count.
DO $$
BEGIN
  INSERT INTO public.billing_checkout_sessions (organization_id, price_id, plan, status, paddle_transaction_id)
  VALUES ('00000000-0000-4000-8000-00000000b0b0', 'pri_starter', 'starter', 'completed', 'txn_smoke_done');
  INSERT INTO public.billing_checkout_sessions (organization_id, price_id, plan, status)
  VALUES ('00000000-0000-4000-8000-00000000b0b0', 'pri_starter', 'starter', 'creating');
  BEGIN
    INSERT INTO public.billing_checkout_sessions (organization_id, price_id, plan, status)
    VALUES ('00000000-0000-4000-8000-00000000b0b0', 'pri_team', 'team', 'open');
    RAISE EXCEPTION 'expected a unique violation for a second open checkout';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  ASSERT (SELECT organization_id FROM public.billing_checkout_sessions WHERE paddle_transaction_id = 'txn_smoke_done')
    = '00000000-0000-4000-8000-00000000b0b0', 'transaction -> org lookup must resolve';
END $$;

-- ── apply_past_due_downgrade ────────────────────────────────────────────────

-- Org B: one team subscription, delinquent since 2026-09-01.
DO $$
BEGIN
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0b0', 'sub_smoke_b1', 'ctm_smoke_b', 'pri_team',
    'team', 'active', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_b1","last_event_type":"subscription.created","occurred_at":"2026-08-01T00:00:00Z"}'
  );
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0b0', 'sub_smoke_b1', 'ctm_smoke_b', 'pri_team',
    'team', 'past_due', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_b2","last_event_type":"subscription.past_due","occurred_at":"2026-09-01T00:00:00Z"}'
  );
  UPDATE public.subscriptions SET past_due_since = '2026-09-01T00:00:00Z'
   WHERE paddle_subscription_id = 'sub_smoke_b1';
  ASSERT (SELECT plan FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000b0b0') = 'team',
    'fixture: org B starts on team';
END $$;

-- 14. A CAS on a stale cycle start changes nothing.
DO $$
DECLARE r jsonb; v_sub uuid;
BEGIN
  SELECT id INTO v_sub FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_b1';
  r := public.apply_past_due_downgrade(v_sub, '2026-08-15T00:00:00Z');
  ASSERT r->>'outcome' = 'stale', 'mismatched past_due_since must be stale';
  ASSERT (SELECT plan FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000b0b0') = 'team',
    'stale CAS must not touch the plan';
END $$;

-- 15. The real cycle downgrades, audits, queues one email, closes the cycle.
DO $$
DECLARE r jsonb; v_sub uuid;
BEGIN
  SELECT id INTO v_sub FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_b1';
  r := public.apply_past_due_downgrade(v_sub, '2026-09-01T00:00:00Z');
  ASSERT r->>'outcome' = 'downgraded', 'matching cycle must downgrade';
  ASSERT r->>'to_plan' = 'free' AND (r->>'email_queued')::boolean, 'single live sub must land on free with an email';
  ASSERT (SELECT plan FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000b0b0') = 'free',
    'org B must be free';
  ASSERT (SELECT past_due_since FROM public.subscriptions WHERE id = v_sub) IS NULL, 'cycle must be closed';
  ASSERT (SELECT count(*) FROM public.audit_logs
           WHERE organization_id = '00000000-0000-4000-8000-00000000b0b0'
             AND action = 'billing.plan.auto_downgrade') = 1, 'one audit row';
  ASSERT (SELECT status FROM public.billing_downgrade_notifications
           WHERE subscription_id = v_sub AND stage = 'downgraded') = 'pending',
    'downgrade email must be queued as pending, not marked sent';

  -- Running it again is a no-op.
  r := public.apply_past_due_downgrade(v_sub, '2026-09-01T00:00:00Z');
  ASSERT r->>'outcome' = 'stale', 'second run must be stale';
  ASSERT (SELECT count(*) FROM public.audit_logs
           WHERE organization_id = '00000000-0000-4000-8000-00000000b0b0'
             AND action = 'billing.plan.auto_downgrade') = 1, 'still one audit row';
END $$;

-- 16. Pay, fall behind again: the new cycle warns and downgrades again
--     (the old UNIQUE (subscription_id, stage) blocked this forever).
DO $$
DECLARE r jsonb; v_sub uuid;
BEGIN
  SELECT id INTO v_sub FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_b1';
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0b0', 'sub_smoke_b1', 'ctm_smoke_b', 'pri_team',
    'team', 'active', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_b3","last_event_type":"subscription.updated","occurred_at":"2026-09-10T00:00:00Z"}'
  );
  ASSERT (SELECT plan FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000b0b0') = 'team',
    'recovery must restore team';
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0b0', 'sub_smoke_b1', 'ctm_smoke_b', 'pri_team',
    'team', 'past_due', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_b4","last_event_type":"subscription.past_due","occurred_at":"2026-09-20T00:00:00Z"}'
  );
  UPDATE public.subscriptions SET past_due_since = '2026-09-20T00:00:00Z' WHERE id = v_sub;

  INSERT INTO public.billing_downgrade_notifications (subscription_id, stage, cycle_started_at)
  VALUES (v_sub, 'warning-d3', '2026-09-20T00:00:00Z');
  BEGIN
    INSERT INTO public.billing_downgrade_notifications (subscription_id, stage, cycle_started_at)
    VALUES (v_sub, 'warning-d3', '2026-09-20T00:00:00Z');
    RAISE EXCEPTION 'expected a unique violation for the same stage in the same cycle';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  r := public.apply_past_due_downgrade(v_sub, '2026-09-20T00:00:00Z');
  ASSERT r->>'outcome' = 'downgraded', 'second cycle must downgrade again';
  ASSERT (SELECT count(*) FROM public.billing_downgrade_notifications
           WHERE subscription_id = v_sub AND stage = 'downgraded') = 2, 'one downgrade email per cycle';
END $$;

-- 17. Another live subscription keeps its plan; no "downgraded to free" email.
DO $$
DECLARE r jsonb; v_sub uuid;
BEGIN
  -- Org A: sub_a3 (team) is live, sub_a1 (starter) goes past due.
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'past_due', '2026-09-01T00:00:00Z', now() + interval '30 days', false,
    '{"last_event_id":"evt_12","last_event_type":"subscription.past_due","occurred_at":"2026-09-12T00:00:00Z"}'
  );
  SELECT id INTO v_sub FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a1';
  UPDATE public.subscriptions SET past_due_since = '2026-09-12T00:00:00Z' WHERE id = v_sub;
  r := public.apply_past_due_downgrade(v_sub, '2026-09-12T00:00:00Z');
  ASSERT r->>'outcome' = 'downgraded', 'entitlement of the delinquent sub must expire';
  ASSERT r->>'to_plan' = 'team', 'org must stay on the live sibling plan';
  ASSERT NOT (r->>'email_queued')::boolean, 'no free-downgrade email when not free';
  ASSERT (SELECT plan FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000b0a0') = 'team',
    'org A must stay on team';
END $$;

-- 18. A canceled subscription is never downgraded by the cron.
DO $$
DECLARE r jsonb; v_sub uuid;
BEGIN
  SELECT id INTO v_sub FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a2';
  UPDATE public.subscriptions SET past_due_since = '2026-09-01T00:00:00Z' WHERE id = v_sub;
  r := public.apply_past_due_downgrade(v_sub, '2026-09-01T00:00:00Z');
  ASSERT r->>'outcome' = 'stale', 'canceled subscription must be stale for the cron';
END $$;

DO $$
BEGIN
  ASSERT NOT has_function_privilege('authenticated', 'public.apply_past_due_downgrade(uuid,timestamptz)', 'EXECUTE'),
    'authenticated must not execute apply_past_due_downgrade';
END $$;

-- ── subscription_overage_charges ledger ─────────────────────────────────────

-- 19. One provisional and one true-up row per period, each at most once.
DO $$
DECLARE v_sub uuid;
BEGIN
  SELECT id INTO v_sub FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a3';
  INSERT INTO public.subscription_overage_charges (
    subscription_id, period_start, period_end, overage_requests, overage_quantity,
    price_id, status, kind, charged_quantity, included_requests
  ) VALUES
    (v_sub, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 186458, 187, 'pri_ovg', 'charged', 'provisional', 187, 100000),
    (v_sub, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 200000, 13, 'pri_ovg', 'needs_reconciliation', 'true_up', 0, 100000);
  BEGIN
    INSERT INTO public.subscription_overage_charges (
      subscription_id, period_start, period_end, overage_requests, overage_quantity, price_id, status, kind
    ) VALUES (v_sub, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 1, 1, 'pri_ovg', 'pending', 'true_up');
    RAISE EXCEPTION 'expected a unique violation for a second true_up';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.subscription_overage_charges (
      subscription_id, period_start, period_end, overage_requests, overage_quantity, price_id, status, kind
    ) VALUES (v_sub, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 1, 1, 'pri_ovg', 'no_charge', 'bogus');
    RAISE EXCEPTION 'expected a check violation for an unknown kind';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  -- Legacy writers that do not send kind still get the provisional key.
  INSERT INTO public.subscription_overage_charges (
    subscription_id, period_start, period_end, overage_requests, overage_quantity, price_id, status
  ) VALUES (v_sub, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 5, 1, 'pri_ovg', 'pending');
  ASSERT (SELECT kind FROM public.subscription_overage_charges
           WHERE subscription_id = v_sub AND period_end = '2026-11-01T00:00:00Z') = 'provisional',
    'kind must default to provisional';
END $$;

-- ── live-subscription validity (migration 20260929110400) ───────────────────
--
-- The plan recompute used to trust every active/trialing row. A row whose
-- cancel webhook was lost, or a sandbox row sitting in the production
-- database (CLAUDE.md gotcha #6), then kept a canceled, refunded or
-- delinquent org on a paid plan. Periods above are relative to now() for the
-- same reason: whether a row still counts depends on the clock.

INSERT INTO public.organizations (id, name, owner_id, plan)
VALUES
  ('00000000-0000-4000-8000-00000000b0c0', 'billing-smoke-c', '00000000-0000-4000-8000-00000000b001', 'free'),
  ('00000000-0000-4000-8000-00000000b0d0', 'billing-smoke-d', '00000000-0000-4000-8000-00000000b001', 'free');

-- Org C: one real starter subscription, plus two rows that must not count:
--   * a team row still marked active whose period ended 10 days ago (lost cancel)
--   * an enterprise row under a different Paddle customer (a sandbox leftover)
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0c0', 'sub_smoke_c1', 'ctm_smoke_c', 'pri_starter',
    'starter', 'active', now() - interval '1 day', now() + interval '29 days', false,
    '{"last_event_id":"evt_c1","last_event_type":"subscription.created","occurred_at":"2026-09-01T00:00:00Z"}'
  );
  ASSERT (r->>'created')::boolean, 'a new subscription row must report created';
  ASSERT r->'other_live_subscriptions' = '[]'::jsonb, 'first subscription has no live sibling';

  INSERT INTO public.subscriptions (
    organization_id, paddle_subscription_id, paddle_customer_id, paddle_price_id,
    plan, status, current_period_start, current_period_end
  ) VALUES
    ('00000000-0000-4000-8000-00000000b0c0', 'sub_smoke_c_lost', 'ctm_smoke_c', 'pri_team',
     'team', 'active', now() - interval '40 days', now() - interval '10 days'),
    ('00000000-0000-4000-8000-00000000b0c0', 'sub_smoke_c_sandbox', 'ctm_sandbox_c', 'pri_enterprise',
     'enterprise', 'active', now() - interval '5 days', now() + interval '25 days');
END $$;

-- 20. An active event ignores both stale rows and says so.
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0c0', 'sub_smoke_c1', 'ctm_smoke_c', 'pri_starter',
    'starter', 'active', now() - interval '1 day', now() + interval '29 days', false,
    '{"last_event_id":"evt_c2","last_event_type":"subscription.updated","occurred_at":"2026-09-02T00:00:00Z"}'
  );
  ASSERT NOT (r->>'created')::boolean, 'an update of an existing row must not report created';
  ASSERT r->>'org_plan' = 'starter', 'stale team / sandbox enterprise rows must not lift the plan';
  ASSERT r->>'plan_source' = 'sub_smoke_c1', 'the plan must come from the real subscription';
  ASSERT r->'ignored_live_subscriptions' = '["sub_smoke_c_lost", "sub_smoke_c_sandbox"]'::jsonb,
    'both stale rows must be reported as ignored';
END $$;

-- 21. Canceling the only real subscription lands on free despite the stale rows.
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0c0', 'sub_smoke_c1', 'ctm_smoke_c', 'pri_starter',
    'starter', 'canceled', NULL, NULL, false,
    '{"last_event_id":"evt_c3","last_event_type":"subscription.canceled","occurred_at":"2026-09-03T00:00:00Z"}'
  );
  ASSERT r->>'org_plan' = 'free', 'a lost-cancel or sandbox row must not keep a canceled org paid';
  ASSERT r->>'plan_source' IS NULL, 'free has no source subscription';
  ASSERT (SELECT plan FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000b0c0') = 'free',
    'org C must be free';
END $$;

-- 22. The refund and the past-due downgrade apply the same validity rules.
DO $$
DECLARE r jsonb; v_sub uuid;
BEGIN
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0c0', 'sub_smoke_c1', 'ctm_smoke_c', 'pri_starter',
    'starter', 'active', now() - interval '1 day', now() + interval '29 days', false,
    '{"last_event_id":"evt_c4","last_event_type":"subscription.resumed","occurred_at":"2026-09-04T00:00:00Z"}'
  );
  r := public.apply_paddle_refund('00000000-0000-4000-8000-00000000b0c0', 'sub_smoke_c1');
  ASSERT r->>'org_plan' = 'free', 'refund must not fall back to a stale row';
  ASSERT jsonb_array_length(r->'ignored_live_subscriptions') = 2, 'refund must report the ignored rows';

  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0c0', 'sub_smoke_c1', 'ctm_smoke_c', 'pri_starter',
    'starter', 'past_due', now() - interval '1 day', now() + interval '29 days', false,
    '{"last_event_id":"evt_c5","last_event_type":"subscription.past_due","occurred_at":"2026-09-05T00:00:00Z"}'
  );
  SELECT id INTO v_sub FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_c1';
  UPDATE public.subscriptions SET past_due_since = '2026-09-05T00:00:00Z' WHERE id = v_sub;
  UPDATE public.organizations SET plan = 'starter' WHERE id = '00000000-0000-4000-8000-00000000b0c0';
  r := public.apply_past_due_downgrade(v_sub, '2026-09-05T00:00:00Z');
  ASSERT r->>'to_plan' = 'free', 'the downgrade must not fall back to a stale row';
  ASSERT (r->>'email_queued')::boolean, 'landing on free queues the downgrade email';
  ASSERT jsonb_array_length(r->'ignored_live_subscriptions') = 2, 'downgrade must report the ignored rows';
END $$;

-- 23. A live event under a NEW customer counts for its own subscription: the
--     org's stored customer is updated before the recompute, not after.
DO $$
DECLARE r jsonb;
BEGIN
  UPDATE public.organizations SET paddle_customer_id = 'ctm_smoke_d_old'
   WHERE id = '00000000-0000-4000-8000-00000000b0d0';
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0d0', 'sub_smoke_d1', 'ctm_smoke_d', 'pri_team',
    'team', 'active', now() - interval '1 day', now() + interval '29 days', false,
    '{"last_event_id":"evt_d1","last_event_type":"subscription.created","occurred_at":"2026-09-01T00:00:00Z"}'
  );
  ASSERT r->>'org_plan' = 'team', 'the subscription the event is about must always count';
  ASSERT (SELECT paddle_customer_id FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000b0d0')
    = 'ctm_smoke_d', 'the org must now carry the new customer';
END $$;

-- 24. A second live subscription for the same org is reported, so the webhook
--     can raise a duplicate-billing alert (C4.2: two checkouts both paid).
DO $$
DECLARE r jsonb;
BEGIN
  r := public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0d0', 'sub_smoke_d2', 'ctm_smoke_d', 'pri_starter',
    'starter', 'active', now() - interval '1 day', now() + interval '29 days', false,
    '{"last_event_id":"evt_d2","last_event_type":"subscription.created","occurred_at":"2026-09-02T00:00:00Z"}'
  );
  ASSERT (r->>'created')::boolean, 'the second subscription is a new row';
  ASSERT r->'other_live_subscriptions' = '["sub_smoke_d1"]'::jsonb, 'the live sibling must be reported';
  ASSERT r->>'org_plan' = 'team', 'the higher live tier still wins';
END $$;

-- 25. A row marked charged must say how much was charged. Otherwise the
--     true-up (final quantity minus sum(charged_quantity)) bills it again.
DO $$
DECLARE v_sub uuid;
BEGIN
  SELECT id INTO v_sub FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_d1';
  INSERT INTO public.subscription_overage_charges (
    subscription_id, period_start, period_end, overage_requests, overage_quantity,
    price_id, status, kind, charged_quantity
  ) VALUES (v_sub, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 5000, 5, 'pri_ovg', 'needs_reconciliation', 'provisional', 0);
  BEGIN
    UPDATE public.subscription_overage_charges SET status = 'charged'
     WHERE subscription_id = v_sub AND kind = 'provisional';
    RAISE EXCEPTION 'expected a check violation for charged without charged_quantity';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  UPDATE public.subscription_overage_charges SET status = 'charged', charged_quantity = 5
   WHERE subscription_id = v_sub AND kind = 'provisional';
  -- Nothing owed, nothing charged: still a valid 'charged' row.
  INSERT INTO public.subscription_overage_charges (
    subscription_id, period_start, period_end, overage_requests, overage_quantity,
    price_id, status, kind, charged_quantity
  ) VALUES (v_sub, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 0, 0, 'pri_ovg', 'charged', 'true_up', 0);
END $$;

-- ── privileges ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon',
    'public.org_live_plan_resolution(uuid,text,text)', 'EXECUTE'),
    'anon must not execute org_live_plan_resolution';
  ASSERT NOT has_function_privilege('anon',
    'public.apply_paddle_subscription_event(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,jsonb)',
    'EXECUTE'), 'anon must not execute apply_paddle_subscription_event';
  ASSERT NOT has_function_privilege('authenticated', 'public.apply_paddle_refund(uuid,text)', 'EXECUTE'),
    'authenticated must not execute apply_paddle_refund';
  ASSERT has_function_privilege('service_role', 'public.apply_paddle_refund(uuid,text)', 'EXECUTE'),
    'service_role must execute apply_paddle_refund';
END $$;

\echo 'billing RPC smoke: all assertions passed'

ROLLBACK;
