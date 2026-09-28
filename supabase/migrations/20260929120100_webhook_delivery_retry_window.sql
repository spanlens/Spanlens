-- Migration: retry window for webhook delivery retries.
--
-- Follows 20260929120000_webhook_delivery_claim.sql, which made the retry
-- claim atomic. That claim had no upper bound on age: any failed delivery
-- whose next_retry_at had passed was due, however old it was. Until this
-- release /cron/retry-webhooks had no scheduler, so failed deliveries have
-- been piling up with next_retry_at in the past. The first scheduled run
-- would have sent all of them, weeks-old request.created events and failed
-- test pings included, to customer endpoints.
--
-- The normal schedule (retries 1, 2, 4 and 8 minutes apart, a run every
-- 5 minutes) finishes in about 30 minutes. A delivery still pending far past
-- that means the retry job itself was not running, and sending it now would
-- deliver a stale event. claim_webhook_deliveries() therefore takes
-- p_max_age_seconds (the server passes 24 hours), measured from delivered_at,
-- which is set when the first attempt is recorded and never changed by a
-- retry:
--
--   - A pending delivery older than the window is dead-lettered with the new
--     reason 'expired', in the same call and before anything is claimed. The
--     first run after deploy clears the historical backlog without sending
--     any of it, and a future stall of the retry job cannot flood endpoints
--     with day-old events either.
--   - The claim itself only takes deliveries inside the window.
--
-- 'expired' is its own reason rather than 'exhausted' on purpose. 'exhausted'
-- tells an operator that the customer's endpoint kept failing; 'expired' says
-- our retry job was not running. The disaster-recovery runbook acts on them
-- differently.
--
-- A new parameter makes a new function signature, so the three-argument
-- version from 20260929120000 is dropped instead of being left behind as an
-- overload without the window. Nothing calls it: both migrations ship in the
-- same release as the server code, which calls the four-argument version.
--
-- Idempotent: the dlq_reason CHECK is rebuilt from pg_constraint, DROP
-- FUNCTION IF EXISTS, CREATE OR REPLACE.

-- ── dlq_reason gains 'expired' ─────────────────────────────────────────────
-- The CHECK was declared inline in 20260701130000, so Postgres named it. Drop
-- whichever CHECK covers dlq_reason instead of assuming that name.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.webhook_deliveries'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%dlq_reason%'
  LOOP
    EXECUTE format('ALTER TABLE public.webhook_deliveries DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_dlq_reason_check
  CHECK (dlq_reason IN ('exhausted', 'webhook_deleted', 'payload_missing', 'expired'));

COMMENT ON COLUMN public.webhook_deliveries.dlq_reason IS
  'Why it was dead-lettered: exhausted (hit MAX_ATTEMPTS), expired (still pending past the retry window, so the retry job was not running), webhook_deleted (endpoint removed/disabled), or payload_missing.';

-- ── claim with a retry window ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.claim_webhook_deliveries(integer, integer, integer);

CREATE OR REPLACE FUNCTION public.claim_webhook_deliveries(
  p_limit           integer,
  p_lease_seconds   integer,
  p_max_attempts    integer,
  p_max_age_seconds integer
)
RETURNS TABLE (
  id                uuid,
  webhook_id        uuid,
  event_type        text,
  payload           jsonb,
  attempt_count     integer,
  claim_token       uuid,
  webhook_url       text,
  webhook_secret    text,
  webhook_is_active boolean
)
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, public
AS $$
  -- 1. Final attempts that were claimed but never recorded (the run was killed
  --    mid-send). They cannot be claimed again, so dead-letter them here.
  UPDATE public.webhook_deliveries d
     SET next_retry_at = NULL,
         claimed_until = NULL,
         claim_token   = NULL,
         dlq_at        = now(),
         dlq_reason    = 'exhausted'
   WHERE d.claimed_until IS NOT NULL
     AND d.claimed_until < now()
     AND d.status = 'failed'
     AND d.dlq_at IS NULL
     AND d.attempt_count >= p_max_attempts;

  -- 2. Deliveries still pending past the retry window: dead-letter them
  --    instead of sending a stale event. One under a live lease is being sent
  --    right now; the run holding it records the result, and if that attempt
  --    fails too, the next call sweeps it. The first two predicates imply the
  --    predicate of the partial index webhook_deliveries_retry_idx, so the
  --    planner can read the pending set through it instead of scanning the
  --    whole delivery log on every tick.
  UPDATE public.webhook_deliveries d
     SET next_retry_at = NULL,
         claimed_until = NULL,
         claim_token   = NULL,
         dlq_at        = now(),
         dlq_reason    = 'expired'
   WHERE d.status = 'failed'
     AND d.next_retry_at IS NOT NULL
     AND d.dlq_at IS NULL
     AND d.delivered_at < now() - make_interval(secs => p_max_age_seconds)
     AND (d.claimed_until IS NULL OR d.claimed_until < now());

  -- 3. Claim due rows inside the window. SKIP LOCKED hands a row that another
  --    caller is claiming right now to that caller alone; the lease keeps it
  --    away from later callers until this run records the result or the
  --    lease lapses.
  WITH due AS (
    SELECT d.id
      FROM public.webhook_deliveries d
     WHERE d.status = 'failed'
       AND d.dlq_at IS NULL
       AND d.next_retry_at <= now()
       AND d.delivered_at >= now() - make_interval(secs => p_max_age_seconds)
       AND d.attempt_count < p_max_attempts
       AND (d.claimed_until IS NULL OR d.claimed_until < now())
     ORDER BY d.next_retry_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.webhook_deliveries d
       SET attempt_count = d.attempt_count + 1,
           claimed_until = now() + make_interval(secs => p_lease_seconds),
           claim_token   = gen_random_uuid()
      FROM due
     WHERE d.id = due.id
    RETURNING d.id, d.webhook_id, d.event_type, d.payload, d.attempt_count, d.claim_token
  )
  SELECT c.id, c.webhook_id, c.event_type, c.payload, c.attempt_count, c.claim_token,
         w.url, w.secret, w.is_active
    FROM claimed c
    LEFT JOIN public.webhooks w ON w.id = c.webhook_id;
$$;

COMMENT ON FUNCTION public.claim_webhook_deliveries(integer, integer, integer, integer) IS
  'Claims up to p_limit due webhook deliveries for one retry run (FOR UPDATE SKIP LOCKED + lease) and increments attempt_count. Dead-letters abandoned final attempts (exhausted) and deliveries pending longer than p_max_age_seconds since the first attempt (expired). Server only (service_role).';

REVOKE EXECUTE ON FUNCTION public.claim_webhook_deliveries(integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_deliveries(integer, integer, integer, integer)
  TO service_role;
