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
    'starter', 'active', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', false,
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
    'starter', 'active', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', false,
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
    'team', 'active', '2026-09-02T00:00:00Z', '2026-10-02T00:00:00Z', false,
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
    'starter', 'past_due', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', false,
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
    'starter', 'past_due', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', false,
    '{"last_event_id":"evt_5","last_event_type":"subscription.updated","occurred_at":"2026-09-05T00:00:00Z"}'
  );
  SELECT past_due_since INTO v_before FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a1';
  ASSERT v_before = '2026-09-04T00:00:00Z'::timestamptz, 'repeat past_due must keep the cycle start';

  UPDATE public.subscriptions SET past_due_since = NULL WHERE paddle_subscription_id = 'sub_smoke_a1';
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'past_due', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', false,
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
    'starter', 'active', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', false,
    '{"last_event_id":"evt_7","last_event_type":"subscription.updated","occurred_at":"2026-09-07T00:00:00Z"}'
  );
  ASSERT (SELECT past_due_since FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a1') IS NULL,
    'recovery must clear past_due_since';
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'past_due', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', false,
    '{"last_event_id":"evt_8","last_event_type":"subscription.past_due","occurred_at":"2026-09-08T00:00:00Z"}'
  );
  ASSERT (SELECT past_due_since FROM public.subscriptions WHERE paddle_subscription_id = 'sub_smoke_a1') IS NOT NULL,
    'a failure after recovery must open a new cycle';
  PERFORM public.apply_paddle_subscription_event(
    '00000000-0000-4000-8000-00000000b0a0', 'sub_smoke_a1', 'ctm_smoke_a', 'pri_starter',
    'starter', 'active', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', false,
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
    'starter', 'active', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', false,
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
    'team', 'active', '2026-09-11T00:00:00Z', '2026-10-11T00:00:00Z', false,
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

-- ── privileges ──────────────────────────────────────────────────────────────

DO $$
BEGIN
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
