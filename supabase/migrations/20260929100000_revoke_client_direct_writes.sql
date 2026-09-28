-- Close the Data API as a write path, and seal the `requests` partitions.
--
-- The browser holds the anon key and the signed-in user's JWT, and the
-- Supabase Data API accepts both: PostgREST at /rest/v1, and pg_graphql at
-- /graphql/v1 wherever that extension is installed. Spanlens never meant
-- either to be a write path. Every write goes through apps/server, which
-- checks the caller's org role and key scope first and then writes with
-- service_role (supabaseAdmin) or the pooled `postgres` connection, both of
-- which bypass RLS. The database did not enforce that, and three audit
-- findings (docs/quality/XVERIFY-2026-09-28.md) follow from the gap:
--
--   C2.1  organizations: org_insert / org_update check only owner_id, and the
--         hosted platform grants authenticated INSERT and UPDATE on every
--         column. An owner could PATCH /rest/v1/organizations and set their
--         own plan to enterprise (unlimited quota, 365-day retention), or
--         rewrite paddle_customer_id, without paying.
--
--   C2.2  api_keys, provider_keys, projects, datasets and the other org
--         tables: the write policies ask only is_org_member(), never the
--         role. A viewer could insert a working full-scope API key with a raw
--         value they chose, deactivate an admin's key, repoint the org's
--         provider key at their own key, or delete a project and cascade
--         every key under it, all without touching the server's role checks,
--         audit log or cache invalidation.
--
--   C2.3  requests: RLS and privileges are per-table in Postgres and are not
--         inherited by partitions. The parent has RLS plus a restrictive deny
--         policy, but every monthly partition and requests_default had RLS
--         off and the platform's default grants (full access for anon and
--         authenticated). PostgREST happens to hide partitions from its schema
--         cache; pg_graphql does not, and served every tenant's prompt and
--         response bodies to the anon key in local reproduction. Production
--         does not have pg_graphql installed today, which is luck rather than
--         design, and a self-hosted stack with GraphQL on is exposed at once.
--
-- Evidence that nothing legitimate writes through those roles (checked
-- against every call site at the time of writing):
--   * apps/web uses supabase-js with the user's session for auth.* calls
--     only (getUser, getSession, sign-in, identities). Its only table reads,
--     in middleware.ts, go through a service_role client. No .from(), .rpc(),
--     storage or realtime call runs as anon or authenticated.
--   * apps/server uses its anon client (supabaseClient) for auth.getUser()
--     only; every table and RPC call goes through supabaseAdmin or the pooler.
--   * The Playwright specs seed through the service_role key.
--
-- So the model becomes: anon and authenticated may read what their SELECT
-- policies allow and nothing else. It is enforced twice, independently:
--
--   1. Privileges. No INSERT/UPDATE/DELETE/TRUNCATE (or REFERENCES, TRIGGER,
--      MAINTAIN) on any relation in public; no privilege at all on the
--      requests tables; EXECUTE on no public function except
--      is_org_member(uuid), which the SELECT policies call as authenticated.
--   2. RLS. Every permissive write policy open to public/anon/authenticated
--      is dropped, and every requests partition gets RLS enabled with no
--      policy. If a later GRANT puts privileges back, RLS still refuses.
--
-- SELECT grants and SELECT policies are left exactly as they are.
--
-- The privilege half lives in enforce_client_privileges() so it can be
-- re-applied, not just applied once: scripts/local-db-setup.mjs mirrors the
-- hosted platform's creation-time grants onto a local stack and then calls
-- it, which is what keeps local permissions identical to production. It also
-- sets this role's default privileges so tables created by later migrations
-- start without client write grants.
--
-- supabase/tests/direct-write-privileges.sql proves both layers, each one on
-- its own, and fails on any public function, table or policy that drifts
-- from this model.
--
-- Functions are handled by the sweep in enforce_client_privileges() rather
-- than by default privileges. Postgres grants EXECUTE on new functions to
-- PUBLIC globally, and anon and authenticated inherit from PUBLIC, so a
-- per-schema default revoke would change nothing. A migration that adds a
-- function should REVOKE it from PUBLIC, anon and authenticated itself; the
-- test above catches one that forgets.

BEGIN;

-- Section 3 takes every table lock this migration needs in one statement,
-- and explains how long that may take. After it nothing should wait on a
-- lock at all; if something does, fail within a second instead of holding
-- the tables already taken while it queues.
SET LOCAL lock_timeout = '1s';

-- ── 1. The privilege model, as a function that can be re-applied ─────────

CREATE OR REPLACE FUNCTION public.enforce_client_privileges()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Postgres 17 added MAINTAIN (LOCK TABLE, VACUUM, REINDEX, ...). The
  -- hosted platform grants it to both client roles.
  has_maintain constant boolean :=
    current_setting('server_version_num')::integer >= 170000;
  rel record;
  fn  record;
BEGIN
  -- Client roles may read what their SELECT policies allow and write nothing.
  FOR rel IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I.%I'
      || ' FROM PUBLIC, anon, authenticated',
      rel.nspname, rel.relname
    );
    IF has_maintain AND rel.relkind IN ('r', 'p', 'm') THEN
      EXECUTE format(
        'REVOKE MAINTAIN ON TABLE %I.%I FROM PUBLIC, anon, authenticated',
        rel.nspname, rel.relname
      );
    END IF;
  END LOOP;

  REVOKE USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;

  -- The request log is read only by the server, and only through
  -- lib/requests-query.ts, which scopes every query to one organization.
  -- Nothing on the client side needs even SELECT. pg_partition_tree covers
  -- the parent, every monthly partition and requests_default, because
  -- neither privileges nor the RLS switch are inherited from the parent.
  FOR rel IN
    SELECT n.nspname, c.relname, c.relkind, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid IN (
      SELECT relid FROM pg_partition_tree(to_regclass('public.requests'))
      UNION ALL
      SELECT to_regclass('public.requests_fallback')
    )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE %I.%I FROM PUBLIC, anon, authenticated',
      rel.nspname, rel.relname
    );
    -- Skipped when already on: the ALTER takes ACCESS EXCLUSIVE, and the
    -- current month's partition is taking proxy writes.
    IF NOT rel.relrowsecurity THEN
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', rel.nspname, rel.relname);
    END IF;
  END LOOP;

  -- No public function is callable through /rest/v1/rpc by a client role.
  -- Trigger functions keep working: Postgres checks EXECUTE on a trigger
  -- function when the trigger is created, not when it fires. service_role is
  -- granted explicitly so the server's RPCs never depended on PUBLIC.
  FOR fn IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid IS DISTINCT FROM to_regprocedure('public.is_org_member(uuid)')
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON ROUTINE %I.%I(%s) FROM PUBLIC, anon, authenticated',
      fn.nspname, fn.proname, fn.args
    );
    EXECUTE format(
      'GRANT EXECUTE ON ROUTINE %I.%I(%s) TO service_role',
      fn.nspname, fn.proname, fn.args
    );
  END LOOP;

  -- The one exception. Every membership SELECT policy calls is_org_member()
  -- as authenticated, so revoking it would turn those reads into errors.
  -- anon has no membership to check.
  IF to_regprocedure('public.is_org_member(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated, service_role;
  END IF;

  -- Tables and sequences created later by migrations (which run as postgres)
  -- and by ensure_requests_partitions() (which runs as its owner, postgres)
  -- start out read-only for client roles. SELECT stays in the default so a
  -- new table behaves like every existing one.
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES
    FROM anon, authenticated;
  IF has_maintain THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public'
         || ' REVOKE MAINTAIN ON TABLES FROM anon, authenticated';
  END IF;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE USAGE, UPDATE ON SEQUENCES FROM anon, authenticated;
END;
$$;

-- ── 2. New request partitions are sealed the moment they exist ───────────
--
-- Identical to 20260820100000 apart from the hardening block. CREATE OR
-- REPLACE keeps the owner (postgres), SECURITY DEFINER and the existing
-- EXECUTE revoke; enforce_client_privileges() below re-asserts the revoke.

CREATE OR REPLACE FUNCTION public.ensure_requests_partitions(
  months_ahead integer DEFAULT 3,
  months_back  integer DEFAULT 1
)
RETURNS TABLE (partition_name text, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m           integer;
  range_start date;
  range_end   date;
  part_name   text;
  existed     boolean;
BEGIN
  FOR m IN -GREATEST(months_back, 0)..GREATEST(months_ahead, 0) LOOP
    range_start := date_trunc('month', now())::date + (m || ' months')::interval;
    range_end   := range_start + interval '1 month';
    part_name   := 'requests_' || to_char(range_start, 'YYYY_MM');

    SELECT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = part_name
    ) INTO existed;

    IF NOT existed THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.requests FOR VALUES FROM (%L) TO (%L)',
        part_name, range_start, range_end
      );
      -- Column compression is not reliably inherited by new partitions the way
      -- indexes are, so set it here rather than assuming.
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN request_body SET COMPRESSION lz4,'
        || ' ALTER COLUMN response_body SET COMPRESSION lz4',
        part_name
      );
      -- Neither RLS nor privileges are inherited from public.requests either.
      -- Left alone, a new month would carry this role's default grants (full
      -- access for anon and authenticated on the hosted platform) with RLS
      -- off, readable and writable through pg_graphql by the anon key. The
      -- table is brand new and already locked by the CREATE, so sealing it
      -- here costs nothing and happens before the first row can land.
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part_name);
      EXECUTE format(
        'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        part_name
      );
    END IF;

    partition_name := part_name;
    created := NOT existed;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ── 3. Take every table lock at once, under one time limit ───────────────
--
-- DROP POLICY (section 4) and ALTER TABLE ... ENABLE ROW LEVEL SECURITY
-- (enforce_client_privileges(), section 5) each take ACCESS EXCLUSIVE on
-- their table and keep it until COMMIT. Taken one at a time as those
-- sections reach them, the locks pile up: the policy sweep runs in name
-- order, so api_keys, organizations, projects and provider_keys would be
-- locked early and then held while the migration queued for spans, traces
-- and the current requests partition. lock_timeout limits each of those
-- waits separately, so the hot tables would stay locked for the sum of all
-- of them. Measured locally, two waits of about four seconds each kept
-- api_keys locked for 7.5 seconds, and the migration still succeeded.
--
-- So one LOCK TABLE statement takes the whole set before anything changes,
-- and statement_timeout caps that statement as a whole: at most 3 seconds of
-- waiting in total, at most 1 second on any one table (lock_timeout above),
-- and nothing after it waits. The request log goes first because long reads
-- on it are the likeliest thing to wait for, and waiting there before
-- anything else is held keeps api_keys and the rest free during that wait.
-- On an idle database this takes milliseconds. On a timeout the migration
-- rolls back having changed nothing, and the next deploy runs it again.
--
-- The set is built with the same filters sections 4 and 5 use, so it is
-- exactly the tables they alter.

SET LOCAL statement_timeout = '3s';

DO $$
DECLARE
  targets text;
BEGIN
  SELECT string_agg(format('ONLY %I.%I', n.nspname, c.relname), ', '
                    ORDER BY t.is_log DESC, c.relname)
    INTO targets
  FROM (
    SELECT relid, bool_or(is_log) AS is_log
    FROM (
      -- Tables whose client write policies section 4 drops.
      SELECT format('%I.%I', schemaname, tablename)::regclass::oid AS relid,
             false AS is_log
      FROM pg_policies
      WHERE schemaname = 'public'
        AND permissive = 'PERMISSIVE'
        AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
        AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
      UNION ALL
      -- Request tables that enforce_client_privileges() turns RLS on for.
      SELECT p.oid, true
      FROM pg_class p
      WHERE p.oid IN (
          SELECT relid FROM pg_partition_tree(to_regclass('public.requests'))
          UNION ALL
          SELECT to_regclass('public.requests_fallback')
        )
        AND NOT p.relrowsecurity
    ) AS wanted
    GROUP BY relid
  ) AS t
  JOIN pg_class c ON c.oid = t.relid
  JOIN pg_namespace n ON n.oid = c.relnamespace;

  IF targets IS NOT NULL THEN
    EXECUTE 'LOCK TABLE ' || targets || ' IN ACCESS EXCLUSIVE MODE';
  END IF;
END;
$$;

SET LOCAL statement_timeout TO DEFAULT;

-- ── 4. Drop the write policies that granted access by membership alone ───
--
-- With the privileges gone these policies can no longer admit anything, but
-- they are the second layer: without them, a GRANT that comes back later
-- (a platform permissions reset, a careless GRANT ALL in a future migration)
-- reopens exactly the holes above. The server writes as service_role or as
-- the table owner and bypasses RLS, so none of them was ever on a real path.
--
-- Swept from the catalog rather than listed, so a policy that exists in
-- production but in no migration goes too. Restrictive (deny) policies and
-- policies for service_role are untouched, as is every SELECT policy.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND permissive = 'PERMISSIVE'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
    ORDER BY tablename, policyname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   pol.policyname, pol.schemaname, pol.tablename);
    RAISE NOTICE 'dropped client write policy %.% (%)', pol.tablename, pol.policyname, pol.cmd;
  END LOOP;
END;
$$;

-- ── 5. Apply ──────────────────────────────────────────────────────────────

SELECT public.enforce_client_privileges();

COMMIT;
