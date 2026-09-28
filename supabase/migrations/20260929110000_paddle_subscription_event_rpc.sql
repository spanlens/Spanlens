-- ─────────────────────────────────────────────────────────────────────────────
-- Paddle subscription events: ordered, atomic application + plan recompute.
--
-- WHY (quality audit 2026-09-28, C3.1 / C4.2):
--   The webhook used to SELECT metadata.occurred_at, compare in JS, then
--   UPSERT the whole row, then UPDATE organizations.plan in a separate
--   request whose { error } it never read. Three problems followed:
--     1. Two events for the same subscription arriving together could both
--        pass the ordering check against the same old timestamp. The later
--        writer won and could move occurred_at backwards.
--     2. An org UPDATE that failed was answered with HTTP 200, so Paddle
--        never retried and subscriptions / organizations.plan disagreed.
--     3. A canceled event flipped the org to 'free' even when another
--        subscription on the same org was still active.
--
-- WHAT:
--   apply_paddle_subscription_event() does the ordering check inside the
--   ON CONFLICT ... DO UPDATE ... WHERE clause, so Postgres evaluates it
--   against the locked, latest committed row. The org row is locked first,
--   so events for different subscriptions of one org serialize too. The
--   org plan is then recomputed from every live subscription of the org in
--   the same transaction: either both writes land or neither does, and the
--   caller turns a failure into a 5xx that Paddle retries.
--
--   An event whose occurred_at EQUALS the stored one is re-applied. That is
--   what makes a Paddle retry (or a manual resend from the dashboard) of an
--   event that previously failed half way safe and useful.
--
--   past_due_since now starts a delinquency cycle only on the transition
--   into past_due. A repeated past_due event keeps the stored value, which
--   stays NULL after the downgrade cron has closed the cycle, so the same
--   cycle is not re-opened and re-warned. Recovery (active/trialing) clears
--   it as before, so the next failure starts a fresh cycle.
--
-- All functions are service_role only.
-- ─────────────────────────────────────────────────────────────────────────────

-- Lenient timestamptz parse: NULL instead of an exception for bad input.
-- Paddle always sends ISO-8601, but a malformed stored value must not make
-- every later event for that subscription fail.
CREATE OR REPLACE FUNCTION public.billing_try_timestamptz(p_raw text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN
    RETURN NULL;
  END IF;
  RETURN p_raw::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- The plan an org is entitled to from its live (active / trialing) Paddle
-- subscriptions: the highest tier wins, no live subscription means 'free'.
-- p_exclude_paddle_subscription_id drops one subscription from the pick,
-- which is how an approved refund removes its own entitlement before Paddle
-- sends the matching subscription.canceled.
CREATE OR REPLACE FUNCTION public.org_plan_from_live_subscriptions(
  p_organization_id uuid,
  p_exclude_paddle_subscription_id text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT s.plan
        FROM public.subscriptions s
       WHERE s.organization_id = p_organization_id
         AND s.status IN ('active', 'trialing')
         AND (p_exclude_paddle_subscription_id IS NULL
              OR s.paddle_subscription_id <> p_exclude_paddle_subscription_id)
       ORDER BY CASE s.plan
                  WHEN 'enterprise' THEN 3
                  WHEN 'team' THEN 2
                  WHEN 'starter' THEN 1
                  ELSE 0
                END DESC
       LIMIT 1
    ),
    'free'
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_paddle_subscription_event(
  p_organization_id uuid,
  p_paddle_subscription_id text,
  p_paddle_customer_id text,
  p_paddle_price_id text,
  p_plan text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_incoming timestamptz := public.billing_try_timestamptz(p_metadata->>'occurred_at');
  v_subscription_id uuid;
  v_org_plan text;
BEGIN
  -- Serialize every event that touches this org (lock order: org, then sub).
  PERFORM 1 FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization % not found', p_organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO public.subscriptions AS s (
    organization_id, paddle_subscription_id, paddle_customer_id, paddle_price_id,
    plan, status, current_period_start, current_period_end, cancel_at_period_end,
    metadata, past_due_since
  )
  VALUES (
    p_organization_id, p_paddle_subscription_id, p_paddle_customer_id, p_paddle_price_id,
    p_plan, p_status, p_current_period_start, p_current_period_end,
    COALESCE(p_cancel_at_period_end, false),
    p_metadata,
    CASE WHEN p_status = 'past_due' THEN now() END
  )
  ON CONFLICT (paddle_subscription_id) DO UPDATE SET
    organization_id      = EXCLUDED.organization_id,
    paddle_customer_id   = EXCLUDED.paddle_customer_id,
    paddle_price_id      = EXCLUDED.paddle_price_id,
    plan                 = EXCLUDED.plan,
    status               = EXCLUDED.status,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end   = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    metadata             = EXCLUDED.metadata,
    past_due_since       = CASE
      WHEN EXCLUDED.status = 'past_due' AND s.status = 'past_due' THEN s.past_due_since
      WHEN EXCLUDED.status = 'past_due' THEN COALESCE(s.past_due_since, now())
      WHEN EXCLUDED.status IN ('active', 'trialing') THEN NULL
      ELSE s.past_due_since
    END
  -- Skip only when the incoming event is provably OLDER than the stored one.
  -- Ambiguous comparisons (either side missing or unparsable) apply, as the
  -- previous application-level guard did.
  WHERE v_incoming IS NULL
     OR public.billing_try_timestamptz(s.metadata->>'occurred_at') IS NULL
     OR public.billing_try_timestamptz(s.metadata->>'occurred_at') <= v_incoming
  RETURNING s.id INTO v_subscription_id;

  IF v_subscription_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'org_plan', NULL);
  END IF;

  -- past_due and paused leave the org plan alone: past_due has a 7-day grace
  -- period owned by the downgrade cron, paused waits for resume or cancel.
  IF p_status IN ('active', 'trialing', 'canceled') THEN
    v_org_plan := public.org_plan_from_live_subscriptions(p_organization_id, NULL);
    UPDATE public.organizations
       SET plan = v_org_plan,
           paddle_customer_id = CASE
             WHEN p_status IN ('active', 'trialing') THEN p_paddle_customer_id
             ELSE paddle_customer_id
           END
     WHERE id = p_organization_id;
  END IF;

  RETURN jsonb_build_object('applied', true, 'org_plan', v_org_plan);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_paddle_refund(
  p_organization_id uuid,
  p_paddle_subscription_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_org_plan text;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization % not found', p_organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  v_org_plan := public.org_plan_from_live_subscriptions(
    p_organization_id, p_paddle_subscription_id
  );
  UPDATE public.organizations SET plan = v_org_plan WHERE id = p_organization_id;

  RETURN jsonb_build_object('org_plan', v_org_plan);
END;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- directly (not only through PUBLIC), so revoke from all three.
REVOKE ALL ON FUNCTION public.billing_try_timestamptz(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_plan_from_live_subscriptions(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_paddle_subscription_event(
  uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_paddle_refund(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.billing_try_timestamptz(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_plan_from_live_subscriptions(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_paddle_subscription_event(
  uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_paddle_refund(uuid, text) TO service_role;
