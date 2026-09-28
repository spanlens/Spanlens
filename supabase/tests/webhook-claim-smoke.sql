-- Checks claim_webhook_deliveries() (migrations 20260929120000 and
-- 20260929120100) against a real Postgres.
--
-- Why this file exists: lib/webhook-dispatch.ts is unit-tested against an
-- in-memory stand-in for this RPC. The stand-in mirrors the SQL, but only
-- Postgres can prove the SQL itself: the due filter, the lease, the
-- attempt_count bump, the abandoned-final-attempt sweep, the retry-window
-- sweep, and the EXECUTE lockdown. A regression in any of those either sends
-- a delivery twice, sends a stale one, or stops retries without an error.
-- CI runs it right after `supabase db reset`.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/webhook-claim-smoke.sql
-- Everything runs inside one transaction that is rolled back.
--
-- Note: privileges are checked with has_function_privilege(). SET ROLE inside
-- a plpgsql exception block crashes the backend on the Supabase Postgres
-- image, so do not rewrite those checks as "try to call it as anon".

\set ON_ERROR_STOP on

\echo '── webhook claim smoke ──'

BEGIN;

-- Own fixture tenant: CI resets with --no-seed, so nothing else exists.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES (
  '00000000-0000-4000-8000-00000000f101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'webhook-smoke@spanlens.test'
);
INSERT INTO organizations (id, name, owner_id)
VALUES ('00000000-0000-4000-8000-00000000f102', 'webhook-smoke', '00000000-0000-4000-8000-00000000f101');

INSERT INTO webhooks (id, organization_id, name, url, secret, is_active) VALUES
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000f102', 'on',  'https://hooks.example.com/on',  's-on',  true),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000f102', 'off', 'https://hooks.example.com/off', 's-off', false);

-- delivered_at is when the first attempt was recorded; the retry window
-- (p_max_age_seconds, 24 hours below) is measured from it.
INSERT INTO webhook_deliveries
  (id, webhook_id, event_type, status, payload, attempt_count, next_retry_at, claimed_until, dlq_at, delivered_at)
VALUES
  -- 01 due, attempt 1: claimable
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'request.created', 'failed', '{"n":1}', 1, now() - interval '2 minutes', NULL, NULL, now() - interval '3 minutes'),
  -- 02 due, attempt 4, disabled webhook: claimable (the server dead-letters it)
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2', 'request.created', 'failed', '{"n":2}', 4, now() - interval '1 minute', NULL, NULL, now() - interval '20 minutes'),
  -- 03 not due yet
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1', 'request.created', 'failed', '{"n":3}', 1, now() + interval '5 minutes', NULL, NULL, now()),
  -- 04 live lease held by another run
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a1', 'request.created', 'failed', '{"n":4}', 2, now() - interval '5 minutes', now() + interval '4 minutes', NULL, now() - interval '8 minutes'),
  -- 05 lapsed lease, attempt 3: claimable again
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a1', 'request.created', 'failed', '{"n":5}', 3, now() - interval '9 minutes', now() - interval '1 minute', NULL, now() - interval '20 minutes'),
  -- 06 lapsed lease on the final attempt: swept to the DLQ as exhausted, not claimed
  ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000a1', 'request.created', 'failed', '{"n":6}', 5, now() - interval '9 minutes', now() - interval '1 minute', NULL, now() - interval '40 minutes'),
  -- 07 already delivered
  ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000a1', 'request.created', 'success', '{"n":7}', 1, NULL, NULL, NULL, now()),
  -- 08 already dead-lettered
  ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-0000000000a1', 'request.created', 'failed', '{"n":8}', 2, now() - interval '9 minutes', NULL, now(), now() - interval '1 hour'),
  -- 09 due but past the retry window (the backlog a stalled retry job leaves): swept to the DLQ as expired, not claimed
  ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-0000000000a1', 'test', 'failed', '{"n":9}', 2, now() - interval '1 minute', NULL, NULL, now() - interval '25 hours'),
  -- 10 past the window but under a live lease: left to the run that holds it
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-0000000000a1', 'request.created', 'failed', '{"n":10}', 3, now() - interval '5 minutes', now() + interval '4 minutes', NULL, now() - interval '25 hours'),
  -- 11 due, just inside the window: claimable
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-0000000000a1', 'request.created', 'failed', '{"n":11}', 1, now() - interval '1 minute', NULL, NULL, now() - interval '23 hours'),
  -- 12 old failure that was never queued (no next_retry_at): not the queue's business
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-0000000000a1', 'request.created', 'failed', '{"n":12}', 1, NULL, NULL, NULL, now() - interval '90 days');

-- The server calls it as service_role (supabaseAdmin).
SET LOCAL ROLE service_role;
CREATE TEMP TABLE first_claim ON COMMIT DROP AS
  SELECT * FROM public.claim_webhook_deliveries(10, 300, 5, 86400);
RESET ROLE;

DO $$
BEGIN
  IF (SELECT array_agg(id ORDER BY id)::text FROM first_claim) IS DISTINCT FROM
     '{00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000002,00000000-0000-4000-8000-000000000005,00000000-0000-4000-8000-000000000011}'
  THEN RAISE EXCEPTION 'claimed the wrong rows: %', (SELECT array_agg(id ORDER BY id) FROM first_claim); END IF;

  IF (SELECT attempt_count FROM webhook_deliveries WHERE id = '00000000-0000-4000-8000-000000000001') <> 2
  THEN RAISE EXCEPTION 'attempt_count was not incremented by the claim'; END IF;

  IF (SELECT claimed_until FROM webhook_deliveries WHERE id = '00000000-0000-4000-8000-000000000001')
     <> now() + interval '300 seconds'
  THEN RAISE EXCEPTION 'lease is not now() + p_lease_seconds'; END IF;

  IF (SELECT count(DISTINCT claim_token) FROM first_claim WHERE claim_token IS NOT NULL) <> 4
  THEN RAISE EXCEPTION 'every claimed row needs its own token'; END IF;

  IF (SELECT webhook_is_active FROM first_claim WHERE id = '00000000-0000-4000-8000-000000000002') IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'webhook columns were not joined onto the claim'; END IF;

  IF (SELECT dlq_reason FROM webhook_deliveries WHERE id = '00000000-0000-4000-8000-000000000006') IS DISTINCT FROM 'exhausted'
     OR (SELECT claimed_until FROM webhook_deliveries WHERE id = '00000000-0000-4000-8000-000000000006') IS NOT NULL
  THEN RAISE EXCEPTION 'abandoned final attempt was not dead-lettered'; END IF;

  IF (SELECT attempt_count FROM webhook_deliveries WHERE id = '00000000-0000-4000-8000-000000000004') <> 2
  THEN RAISE EXCEPTION 'a row under a live lease was touched'; END IF;

  -- Retry window.
  IF (SELECT row(dlq_reason, next_retry_at, attempt_count)::text FROM webhook_deliveries
       WHERE id = '00000000-0000-4000-8000-000000000009') IS DISTINCT FROM '(expired,,2)'
     OR (SELECT dlq_at FROM webhook_deliveries WHERE id = '00000000-0000-4000-8000-000000000009') IS NULL
  THEN RAISE EXCEPTION 'a delivery past the retry window was not dead-lettered as expired'; END IF;

  IF (SELECT row(dlq_at, attempt_count)::text FROM webhook_deliveries
       WHERE id = '00000000-0000-4000-8000-000000000010') IS DISTINCT FROM '(,3)'
  THEN RAISE EXCEPTION 'the retry-window sweep took a delivery that another run is sending'; END IF;

  IF (SELECT dlq_at FROM webhook_deliveries WHERE id = '00000000-0000-4000-8000-000000000012') IS NOT NULL
  THEN RAISE EXCEPTION 'the retry-window sweep touched a delivery that was never queued'; END IF;
END $$;

-- An immediate second claim finds nothing: every due row is leased.
SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.claim_webhook_deliveries(10, 300, 5, 86400)) <> 0
  THEN RAISE EXCEPTION 'a second claim returned rows that are already leased'; END IF;
END $$;
RESET ROLE;

-- The result write is conditional on the token, so a stale claim changes nothing.
DO $$
DECLARE hits int;
BEGIN
  UPDATE webhook_deliveries
     SET status = 'success', claimed_until = NULL, claim_token = NULL
   WHERE id = '00000000-0000-4000-8000-000000000001' AND claim_token = gen_random_uuid();
  GET DIAGNOSTICS hits = ROW_COUNT;
  IF hits <> 0 THEN RAISE EXCEPTION 'a stale claim token overwrote the row'; END IF;
END $$;

-- Only the server may claim, and only through the current signature.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.claim_webhook_deliveries(integer,integer,integer,integer)', 'EXECUTE')
  THEN RAISE EXCEPTION 'anon can execute claim_webhook_deliveries'; END IF;
  IF has_function_privilege('authenticated', 'public.claim_webhook_deliveries(integer,integer,integer,integer)', 'EXECUTE')
  THEN RAISE EXCEPTION 'authenticated can execute claim_webhook_deliveries'; END IF;
  IF NOT has_function_privilege('service_role', 'public.claim_webhook_deliveries(integer,integer,integer,integer)', 'EXECUTE')
  THEN RAISE EXCEPTION 'service_role cannot execute claim_webhook_deliveries'; END IF;
  IF to_regprocedure('public.claim_webhook_deliveries(integer,integer,integer)') IS NOT NULL
  THEN RAISE EXCEPTION 'the three-argument claim_webhook_deliveries without a retry window still exists'; END IF;
END $$;

ROLLBACK;

\echo '── webhook claim checks passed ──'
