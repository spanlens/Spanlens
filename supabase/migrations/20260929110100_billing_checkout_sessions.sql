-- ─────────────────────────────────────────────────────────────────────────────
-- billing_checkout_sessions — one open Paddle checkout per organization.
--
-- WHY (quality audit 2026-09-28, C4.1 / C4.2):
--   POST /api/v1/billing/checkout guarded against double billing only by
--   looking for a live row in `subscriptions`. That row is written by the
--   webhook AFTER payment, so before payment (two tabs, two admins, or an
--   abandoned checkout completed later) any number of Paddle transactions
--   could be created and each one could become its own subscription.
--   Separately, a webhook event that arrives without custom_data had no way
--   to map its transaction back to the org that started it, so it fell back
--   to paddle_customer_id, which is shared by every workspace a person pays
--   for (Paddle customers are unique per email).
--
-- WHAT:
--   A row per checkout attempt. The partial UNIQUE index allows at most one
--   'creating' or 'open' row per org, which is the org-level idempotency key:
--   a concurrent second request fails the INSERT (23505) instead of creating
--   a second Paddle transaction. The API reuses an open session for the same
--   price within 30 minutes and refuses a different plan until it expires.
--   paddle_transaction_id gives the webhook an exact transaction -> org map.
--
--   Lifecycle: creating -> open (Paddle transaction created)
--                       -> failed (Paddle call failed)
--              open     -> completed (transaction.completed webhook)
--              creating/open -> expired (older than the reuse window)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.billing_checkout_sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  price_id               TEXT NOT NULL,
  plan                   TEXT NOT NULL CHECK (plan IN ('starter', 'team', 'enterprise')),
  status                 TEXT NOT NULL DEFAULT 'creating'
                           CHECK (status IN ('creating', 'open', 'completed', 'failed', 'expired')),
  paddle_transaction_id  TEXT UNIQUE,
  checkout_url           TEXT,
  -- auth.users id of the admin who started it; audit only, so no FK.
  created_by             UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_checkout_sessions_one_open_per_org
  ON public.billing_checkout_sessions (organization_id)
  WHERE status IN ('creating', 'open');

CREATE INDEX IF NOT EXISTS billing_checkout_sessions_org_created_idx
  ON public.billing_checkout_sessions (organization_id, created_at DESC);

DROP TRIGGER IF EXISTS billing_checkout_sessions_updated_at ON public.billing_checkout_sessions;
CREATE TRIGGER billing_checkout_sessions_updated_at
  BEFORE UPDATE ON public.billing_checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.billing_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- Server-only table (supabaseAdmin in api/billing.ts and api/paddleWebhook.ts).
DROP POLICY IF EXISTS billing_checkout_sessions_deny_public ON public.billing_checkout_sessions;
CREATE POLICY billing_checkout_sessions_deny_public ON public.billing_checkout_sessions
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE public.billing_checkout_sessions IS
  'One row per Paddle checkout attempt. Partial UNIQUE (organization_id) WHERE status IN (creating, open) is the org-level checkout idempotency key; paddle_transaction_id maps webhook transactions back to their org.';
