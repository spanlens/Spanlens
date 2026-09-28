-- Exercises the membership RPCs from 20260929130000_org_members_atomic_ops.sql
-- (and the claim column from 20260929130100) against a real Postgres.
--
-- Why this file exists: the server tests for members.ts / invitations.ts mock
-- supabase-js, so they prove the routes call the RPCs and map every status,
-- but not that the SQL does what the statuses claim. The bug these functions
-- fix (two admins demoting each other both reading "2 admins") lived entirely
-- in the gap between a read and a write, which no mocked test can see.
--
-- What it proves:
--   * last-admin protection for role changes and removals
--   * the org-scoped advisory lock is taken and held until the transaction
--     ends, which is what serialises two concurrent calls for the same org
--   * the seat limit gates new members only, re-checks invitation state under
--     the lock, and stamps accepted_at + invited_by
--   * member emails come from auth.users for exactly this org
--   * none of the functions is executable by anon or authenticated
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/org-members-atomic.sql
-- Meant to run after `supabase db reset`, like requests-sql-smoke.sql.
-- Everything happens inside one transaction and is rolled back.

\set ON_ERROR_STOP on

\echo '── org members atomic ops ──'

BEGIN;

-- Fixture: its own users and org, so the file proves the same thing on an
-- empty CI database as on a populated local one.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-a@members.test'),
  ('00000000-0000-4000-8000-00000000a002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-b@members.test'),
  ('00000000-0000-4000-8000-00000000a003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'editor@members.test'),
  ('00000000-0000-4000-8000-00000000a004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invitee@members.test'),
  ('00000000-0000-4000-8000-00000000a005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'late@members.test');

INSERT INTO public.organizations (id, name, owner_id)
VALUES ('00000000-0000-4000-8000-00000000b001', 'members-atomic', '00000000-0000-4000-8000-00000000a001');

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a001', 'admin'),
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a002', 'admin'),
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a003', 'editor');

INSERT INTO public.org_invitations (id, organization_id, email, role, token_hash, invited_by, expires_at) VALUES
  -- valid, for the seat limit test
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000b001', 'invitee@members.test', 'viewer',
   'members-atomic-token-1', '00000000-0000-4000-8000-00000000a001', now() + interval '7 days'),
  -- already expired
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000b001', 'late@members.test', 'viewer',
   'members-atomic-token-2', '00000000-0000-4000-8000-00000000a001', now() - interval '1 minute'),
  -- addressed to someone who is already a member
  ('00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000b001', 'editor@members.test', 'admin',
   'members-atomic-token-3', '00000000-0000-4000-8000-00000000a001', now() + interval '7 days');

\echo '  1/7 role change: demote one of two admins, then refuse the last one'
DO $$
DECLARE
  org constant uuid := '00000000-0000-4000-8000-00000000b001';
  r jsonb;
  admins integer;
BEGIN
  r := public.org_change_member_role(org, '00000000-0000-4000-8000-00000000a001', 'viewer');
  IF r->>'status' <> 'ok' OR r->>'previous_role' <> 'admin' THEN
    RAISE EXCEPTION 'first demote should succeed, got %', r;
  END IF;

  -- The sequential form of the race: the second demote must now see one admin.
  r := public.org_change_member_role(org, '00000000-0000-4000-8000-00000000a002', 'editor');
  IF r->>'status' <> 'last_admin' THEN
    RAISE EXCEPTION 'demoting the last admin should be refused, got %', r;
  END IF;

  SELECT count(*) INTO admins FROM public.org_members WHERE organization_id = org AND role = 'admin';
  IF admins <> 1 THEN
    RAISE EXCEPTION 'expected exactly one admin left, found %', admins;
  END IF;

  r := public.org_change_member_role(org, '00000000-0000-4000-8000-00000000a003', 'editor');
  IF r->>'status' <> 'unchanged' THEN
    RAISE EXCEPTION 'same-role change should be unchanged, got %', r;
  END IF;

  r := public.org_change_member_role(org, '00000000-0000-4000-8000-00000000ffff', 'admin');
  IF r->>'status' <> 'not_found' THEN
    RAISE EXCEPTION 'unknown member should be not_found, got %', r;
  END IF;
END $$;

\echo '  2/7 removal: refuse the last admin, remove anyone else'
DO $$
DECLARE
  org constant uuid := '00000000-0000-4000-8000-00000000b001';
  r jsonb;
BEGIN
  r := public.org_remove_member(org, '00000000-0000-4000-8000-00000000a002');
  IF r->>'status' <> 'last_admin' THEN
    RAISE EXCEPTION 'removing the last admin should be refused, got %', r;
  END IF;

  r := public.org_remove_member(org, '00000000-0000-4000-8000-00000000a001');
  IF r->>'status' <> 'ok' OR r->>'removed_role' <> 'viewer' THEN
    RAISE EXCEPTION 'removing a viewer should succeed, got %', r;
  END IF;

  r := public.org_remove_member(org, '00000000-0000-4000-8000-00000000a001');
  IF r->>'status' <> 'not_found' THEN
    RAISE EXCEPTION 'removing twice should be not_found, got %', r;
  END IF;
END $$;

\echo '  3/7 the org-scoped advisory lock is held until the transaction ends'
-- Every call above ran in this transaction, so the xact-scoped lock for this
-- org must still be held. A concurrent call for the same org blocks on it
-- until COMMIT/ROLLBACK and then re-reads the committed roster, which is what
-- makes "two admins demote each other" impossible.
DO $$
DECLARE
  k bigint := hashtextextended('org_members:00000000-0000-4000-8000-00000000b001', 0);
  held integer;
BEGIN
  SELECT count(*) INTO held
  FROM pg_locks
  WHERE locktype = 'advisory'
    AND pid = pg_backend_pid()
    AND granted
    AND objsubid = 1
    AND ((classid::bigint << 32) | objid::bigint) = k;
  IF held <> 1 THEN
    RAISE EXCEPTION 'expected the org advisory lock to be held, found % rows', held;
  END IF;
END $$;

\echo '  4/7 accept: seat limit blocks new members only'
DO $$
DECLARE
  org constant uuid := '00000000-0000-4000-8000-00000000b001';
  r jsonb;
  members integer;
BEGIN
  -- Two members remain (admin b, editor). A limit of 2 is full.
  r := public.org_accept_invitation('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000a004', 2);
  IF r->>'status' <> 'seat_limit' OR (r->>'members')::int <> 2 OR (r->>'seat_limit')::int <> 2 THEN
    RAISE EXCEPTION 'full org should refuse a new member, got %', r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_invitations WHERE id = '00000000-0000-4000-8000-00000000c001' AND accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a refused accept must leave the invitation pending';
  END IF;

  -- An existing member accepting is not a new seat, even when the org is full.
  r := public.org_accept_invitation('00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000a003', 2);
  IF r->>'status' <> 'already_member' THEN
    RAISE EXCEPTION 'existing member should be already_member, got %', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE organization_id = org
                 AND user_id = '00000000-0000-4000-8000-00000000a003' AND role = 'editor') THEN
    RAISE EXCEPTION 'already_member must not change the existing role';
  END IF;

  -- Unlimited (NULL) lets the new member in, with the inviter recorded.
  r := public.org_accept_invitation('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000a004', NULL);
  IF r->>'status' <> 'joined' OR r->>'role' <> 'viewer' OR (r->>'organization_id')::uuid <> org THEN
    RAISE EXCEPTION 'unlimited org should accept, got %', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE organization_id = org
                 AND user_id = '00000000-0000-4000-8000-00000000a004'
                 AND role = 'viewer'
                 AND invited_by = '00000000-0000-4000-8000-00000000a001') THEN
    RAISE EXCEPTION 'joined member row missing or invited_by not recorded';
  END IF;

  SELECT count(*) INTO members FROM public.org_members WHERE organization_id = org;
  IF members <> 3 THEN
    RAISE EXCEPTION 'expected 3 members after the join, found %', members;
  END IF;
END $$;

\echo '  5/7 accept: invitation state is re-checked under the lock'
DO $$
DECLARE
  r jsonb;
BEGIN
  r := public.org_accept_invitation('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000a004', NULL);
  IF r->>'status' <> 'already_accepted' THEN
    RAISE EXCEPTION 'second accept should be already_accepted, got %', r;
  END IF;

  r := public.org_accept_invitation('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000a005', NULL);
  IF r->>'status' <> 'expired' THEN
    RAISE EXCEPTION 'expired invitation should be expired, got %', r;
  END IF;

  r := public.org_accept_invitation('00000000-0000-4000-8000-00000000ffff', '00000000-0000-4000-8000-00000000a005', NULL);
  IF r->>'status' <> 'not_found' THEN
    RAISE EXCEPTION 'unknown invitation should be not_found, got %', r;
  END IF;
END $$;

\echo '  6/7 member emails come from auth.users, scoped to the org'
DO $$
DECLARE
  got text[];
BEGIN
  SELECT array_agg(email ORDER BY email) INTO got
  FROM public.org_member_emails('00000000-0000-4000-8000-00000000b001');
  IF got IS DISTINCT FROM ARRAY['admin-b@members.test', 'editor@members.test', 'invitee@members.test'] THEN
    RAISE EXCEPTION 'unexpected member emails: %', got;
  END IF;
END $$;

\echo '  7/7 privileges: service_role only, and the claim column exists'
DO $$
DECLARE
  fn text;
  grantee text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.org_change_member_role(uuid, uuid, public.org_role)',
    'public.org_remove_member(uuid, uuid)',
    'public.org_accept_invitation(uuid, uuid, integer)',
    'public.org_member_emails(uuid)'
  ] LOOP
    FOREACH grantee IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(grantee, fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% must not be executable by %', fn, grantee;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be executable by service_role', fn;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pending_deletions'
      AND column_name = 'execution_claimed_at'
  ) THEN
    RAISE EXCEPTION 'pending_deletions.execution_claimed_at is missing';
  END IF;
END $$;

ROLLBACK;

\echo '── membership functions behave ──'
