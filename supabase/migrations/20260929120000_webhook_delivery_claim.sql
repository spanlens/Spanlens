-- Migration: atomic claim for webhook delivery retries.
--
-- retryFailedWebhooks() used to read the due rows with a plain PostgREST
-- SELECT and then POST each one. Nothing marked a row as taken between the
-- read and the send, so two overlapping runs of /cron/retry-webhooks (it is
-- fired by more than one scheduler, CLAUDE.md gotcha #32) sent the same event
-- twice. Both runs then wrote the same absolute attempt_count, so the two
-- sends were counted as one attempt.
--
-- This adds a lease to webhook_deliveries and one RPC that takes it:
--
--   claimed_until  the lease expiry. A row with a live lease is invisible to
--                  other runs. If the run that holds it dies mid-send, the
--                  lease lapses and the next run picks the row up again.
--   claim_token    a fresh uuid per claim. The server writes the attempt's
--                  result with UPDATE ... WHERE claim_token = <token>, so a
--                  run whose lease lapsed and was taken over cannot overwrite
--                  the newer attempt's result.
--
-- claim_webhook_deliveries() locks due rows with FOR UPDATE SKIP LOCKED and
-- bumps attempt_count in the same statement, so concurrent callers split the
-- queue instead of sharing it, and every send is counted exactly once, even
-- one that never reports back.
--
-- It also dead-letters rows whose last allowed attempt was claimed but never
-- finished. Without that sweep such a row would sit at attempt_count = max,
-- which the claim filter excludes, and never reach dlq_at.
--
-- SECURITY INVOKER on purpose. The only caller is supabaseAdmin
-- (service_role), which already has the table privileges and bypasses RLS.
-- If EXECUTE were ever granted wider by mistake, the function would run with
-- the caller's rights, and webhook_deliveries has no UPDATE policy, so it
-- would claim nothing. EXECUTE is still revoked from everyone but
-- service_role (same lockdown as increment_share_view_count).
--
-- Additive and idempotent: nullable columns, IF NOT EXISTS, CREATE OR REPLACE,
-- no backfill (existing rows start unclaimed).

ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS claimed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claim_token   UUID;

COMMENT ON COLUMN public.webhook_deliveries.claimed_until IS
  'Lease expiry while a retry run is sending this delivery. NULL = not claimed.';
COMMENT ON COLUMN public.webhook_deliveries.claim_token IS
  'Token of the current claim. The result write is conditional on it, so a run whose lease was taken over cannot overwrite a newer attempt.';

-- Claimed rows are few and short-lived (the lease is cleared when the attempt
-- is recorded), so this stays tiny. It serves the abandoned-lease sweep, which
-- would otherwise scan the whole delivery log on every tick.
CREATE INDEX IF NOT EXISTS webhook_deliveries_claimed_idx
  ON public.webhook_deliveries (claimed_until)
  WHERE claimed_until IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_webhook_deliveries(
  p_limit         integer,
  p_lease_seconds integer,
  p_max_attempts  integer
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

  -- 2. Claim due rows. SKIP LOCKED hands a row that another caller is
  --    claiming right now to that caller alone; the lease keeps it away from
  --    later callers until this run records the result or the lease lapses.
  WITH due AS (
    SELECT d.id
      FROM public.webhook_deliveries d
     WHERE d.status = 'failed'
       AND d.dlq_at IS NULL
       AND d.next_retry_at <= now()
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

COMMENT ON FUNCTION public.claim_webhook_deliveries(integer, integer, integer) IS
  'Claims up to p_limit due webhook deliveries for one retry run (FOR UPDATE SKIP LOCKED + lease), increments attempt_count, and dead-letters abandoned final attempts. Server only (service_role).';

REVOKE EXECUTE ON FUNCTION public.claim_webhook_deliveries(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_deliveries(integer, integer, integer)
  TO service_role;
