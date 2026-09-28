-- ─────────────────────────────────────────────────────────────────────────────
-- Plan recompute: only trust live subscription rows that still look real.
--
-- WHY (review of the 2026-09-28 billing fixes, follow-up to 20260929110000):
--   org_plan_from_live_subscriptions() picked the highest tier among EVERY
--   active/trialing row of the org. Before that migration a cancel or an
--   approved refund always set 'free'; after it, one stale row was enough to
--   keep a canceled, refunded or delinquent org on a paid plan, silently:
--     * a row whose subscription.canceled webhook was lost stays 'active'
--       forever, with a current_period_end that stops moving;
--     * sandbox rows accumulate in the production database, because Preview
--       deployments talk to Paddle sandbox but share the production Supabase
--       (CLAUDE.md gotcha #6). They carry a sandbox ctm_ customer id.
--   Separately, nothing told the webhook that a NEW subscription had just been
--   created for an org that already pays for one (two checkouts both paid).
--
-- WHAT:
--   org_live_plan_resolution(org, exclude, trusted) returns the plan plus the
--   evidence: which subscription it came from, which live rows counted and
--   which were ignored. A live row counts when
--     * it is the subscription the current event is about (trusted), or
--     * its paddle_customer_id matches the org's stored customer (or the org
--       has none stored), AND its current_period_end is unknown or no more
--       than 3 days in the past. 3 days covers a renewal webhook that is late
--       or still in Paddle's retry backoff; past that, an 'active' row whose
--       period ended is a row whose cancel never arrived.
--   The three state-changing functions are redefined on top of it and return
--   plan_source / ignored_live_subscriptions, so the server can log when a
--   sibling keeps an org paid and when stale rows need cleaning up.
--   apply_paddle_subscription_event also returns `created` and
--   `other_live_subscriptions`, which the webhook turns into a duplicate
--   subscription alert.
--
--   The event function now stores the incoming customer on the org BEFORE the
--   recompute (active / trialing only, as before), so siblings are checked
--   against the customer the org is paying with now.
--
-- BEFORE DEPLOY (ops, read only): orgs holding more than one live row are the
-- ones this changes. Review them, and cancel sandbox leftovers in the table:
--   SELECT organization_id, count(*), array_agg(paddle_subscription_id),
--          array_agg(paddle_customer_id), array_agg(current_period_end)
--     FROM public.subscriptions
--    WHERE status IN ('active', 'trialing')
--    GROUP BY organization_id
--   HAVING count(*) > 1;
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.org_live_plan_resolution(
  p_organization_id uuid,
  p_exclude_paddle_subscription_id text DEFAULT NULL,
  p_trusted_paddle_subscription_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH org AS (
    SELECT o.paddle_customer_id AS customer_id
      FROM public.organizations o
     WHERE o.id = p_organization_id
  ),
  live AS (
    SELECT s.paddle_subscription_id,
           s.plan,
           CASE s.plan
             WHEN 'enterprise' THEN 3
             WHEN 'team' THEN 2
             WHEN 'starter' THEN 1
             ELSE 0
           END AS tier,
           (
             s.paddle_subscription_id = p_trusted_paddle_subscription_id
             OR (
               (
                 (SELECT customer_id FROM org) IS NULL
                 OR s.paddle_customer_id = (SELECT customer_id FROM org)
               )
               AND (
                 s.current_period_end IS NULL
                 OR s.current_period_end > now() - interval '3 days'
               )
             )
           ) IS TRUE AS counts
      FROM public.subscriptions s
     WHERE s.organization_id = p_organization_id
       AND s.status IN ('active', 'trialing')
       AND (p_exclude_paddle_subscription_id IS NULL
            OR s.paddle_subscription_id <> p_exclude_paddle_subscription_id)
  ),
  best AS (
    SELECT paddle_subscription_id, plan
      FROM live
     WHERE counts
     ORDER BY tier DESC, paddle_subscription_id
     LIMIT 1
  )
  SELECT jsonb_build_object(
    'plan', COALESCE((SELECT plan FROM best), 'free'),
    'source', (SELECT paddle_subscription_id FROM best),
    'counted', COALESCE(
      (SELECT jsonb_agg(paddle_subscription_id ORDER BY paddle_subscription_id) FROM live WHERE counts),
      '[]'::jsonb
    ),
    'ignored', COALESCE(
      (SELECT jsonb_agg(paddle_subscription_id ORDER BY paddle_subscription_id) FROM live WHERE NOT counts),
      '[]'::jsonb
    )
  );
$$;

-- Kept for any caller of the old name; same rules as above.
CREATE OR REPLACE FUNCTION public.org_plan_from_live_subscriptions(
  p_organization_id uuid,
  p_exclude_paddle_subscription_id text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.org_live_plan_resolution(
    p_organization_id, p_exclude_paddle_subscription_id, NULL
  )->>'plan';
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
  v_is_live boolean := p_status IN ('active', 'trialing');
  v_created boolean;
  v_subscription_id uuid;
  v_resolution jsonb;
  v_org_plan text;
BEGIN
  -- Serialize every event that touches this org (lock order: org, then sub).
  PERFORM 1 FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization % not found', p_organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Read after taking the org lock: a concurrent event for the same new
  -- subscription has committed by now, so only one of them sees "created".
  v_created := NOT EXISTS (
    SELECT 1 FROM public.subscriptions WHERE paddle_subscription_id = p_paddle_subscription_id
  );

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
  -- Ambiguous comparisons (either side missing or unparsable) apply, and an
  -- EQUAL occurred_at re-applies, so a Paddle retry after a 5xx is useful.
  WHERE v_incoming IS NULL
     OR public.billing_try_timestamptz(s.metadata->>'occurred_at') IS NULL
     OR public.billing_try_timestamptz(s.metadata->>'occurred_at') <= v_incoming
  RETURNING s.id INTO v_subscription_id;

  IF v_subscription_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'created', false, 'org_plan', NULL);
  END IF;

  -- The customer the org pays with now, stored before the recompute so the
  -- sibling check compares against it.
  IF v_is_live THEN
    UPDATE public.organizations
       SET paddle_customer_id = p_paddle_customer_id
     WHERE id = p_organization_id;
  END IF;

  v_resolution := public.org_live_plan_resolution(
    p_organization_id,
    NULL,
    CASE WHEN v_is_live THEN p_paddle_subscription_id END
  );

  -- past_due and paused leave the org plan alone: past_due has a 7-day grace
  -- period owned by the downgrade cron, paused waits for resume or cancel.
  IF v_is_live OR p_status = 'canceled' THEN
    v_org_plan := v_resolution->>'plan';
    UPDATE public.organizations SET plan = v_org_plan WHERE id = p_organization_id;
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'created', v_created,
    'org_plan', v_org_plan,
    'plan_source', CASE WHEN v_org_plan IS NOT NULL THEN v_resolution->>'source' END,
    'other_live_subscriptions', COALESCE(
      (SELECT jsonb_agg(id ORDER BY id)
         FROM jsonb_array_elements_text(v_resolution->'counted') AS c(id)
        WHERE id <> p_paddle_subscription_id),
      '[]'::jsonb
    ),
    'ignored_live_subscriptions', v_resolution->'ignored'
  );
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
  v_resolution jsonb;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization % not found', p_organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  v_resolution := public.org_live_plan_resolution(p_organization_id, p_paddle_subscription_id, NULL);
  UPDATE public.organizations SET plan = v_resolution->>'plan' WHERE id = p_organization_id;

  RETURN jsonb_build_object(
    'org_plan', v_resolution->>'plan',
    'plan_source', v_resolution->>'source',
    'ignored_live_subscriptions', v_resolution->'ignored'
  );
END;
$$;

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
  v_resolution jsonb;
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

  -- Another VALID live subscription keeps its plan; otherwise the org is free.
  v_resolution := public.org_live_plan_resolution(v_org, NULL, NULL);
  v_to_plan := v_resolution->>'plan';
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
      'to_plan', v_to_plan,
      'plan_source', v_resolution->>'source',
      'ignored_live_subscriptions', v_resolution->'ignored'
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
    'email_queued', v_email_queued,
    'plan_source', v_resolution->>'source',
    'ignored_live_subscriptions', v_resolution->'ignored'
  );
END;
$$;

-- CREATE OR REPLACE keeps the grants of the functions that already existed;
-- restate them so this file is correct on its own. Supabase grants EXECUTE on
-- new public functions to anon and authenticated directly, so revoke all three.
REVOKE ALL ON FUNCTION public.org_live_plan_resolution(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_plan_from_live_subscriptions(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_paddle_subscription_event(
  uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_paddle_refund(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_past_due_downgrade(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.org_live_plan_resolution(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_plan_from_live_subscriptions(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_paddle_subscription_event(
  uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_paddle_refund(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_past_due_downgrade(uuid, timestamptz) TO service_role;
