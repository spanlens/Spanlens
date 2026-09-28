-- Proves that the Data API roles (anon, authenticated) cannot write to the
-- database directly, and that the `requests` log is unreachable for them.
--
-- Why this file exists: the browser holds the anon key and the signed-in
-- user's JWT, and the Supabase Data API (PostgREST, plus pg_graphql wherever
-- it is installed) accepts both. Every write the product makes goes through
-- apps/server, which checks org roles and key scopes and then writes with
-- service_role or the pooled `postgres` connection. Until 20260929100000 the
-- database itself enforced none of that. The hosted platform grants anon and
-- authenticated full privileges on every new table, and the write policies
-- only asked "is this user a member?", so:
--   * an owner could set their own workspace's plan to enterprise (C2.1);
--   * a viewer could mint a working API key, deactivate an admin's key, or
--     repoint the org's provider key at a key they control (C2.2);
--   * the monthly `requests` partitions had RLS off, so pg_graphql served
--     every tenant's prompt and response bodies to the anon key (C2.3).
--
-- The fix is two independent layers, and this file tests each one alone:
--   1. Privileges. anon/authenticated hold no write privilege on anything in
--      public, nothing at all on the requests tables, and can execute no
--      public function except is_org_member(), which the SELECT policies call.
--   2. RLS. No permissive write policy exists for those roles, and every
--      requests partition has RLS enabled, so privileges that come back (the
--      platform re-granting defaults, an old local setup script, a careless
--      GRANT ALL in a later migration) still let nothing through.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/direct-write-privileges.sql
-- Everything happens inside one transaction that is rolled back.

\set ON_ERROR_STOP on

\echo '── direct-write privileges ──'

BEGIN;

-- ── Helpers (session-local, discarded at ROLLBACK) ───────────────────────

-- Fails unless every catalog-level rule of the privilege model holds.
CREATE FUNCTION pg_temp.assert_privilege_model() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  offenders text;
  leaf_count integer;
BEGIN
  -- Rule 1: nothing in public is writable by a client role. INSERT, UPDATE
  -- and REFERENCES use the column-aware check so a column-level grant (say,
  -- UPDATE (plan) ON organizations) cannot slip past a table-level one.
  SELECT string_agg(format('%s (%s: %s)', g.relname, g.rolname, g.privs), ', '
                    ORDER BY g.relname, g.rolname)
    INTO offenders
  FROM (
    SELECT c.relname, r.rolname, string_agg(p.priv, ' ' ORDER BY p.priv) AS privs
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                       ('REFERENCES'), ('TRIGGER')) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND CASE WHEN p.priv IN ('INSERT', 'UPDATE', 'REFERENCES')
               THEN has_any_column_privilege(r.rolname, c.oid, p.priv)
               ELSE has_table_privilege(r.rolname, c.oid, p.priv)
          END
    GROUP BY c.relname, r.rolname
  ) AS g;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: client roles can write public relations directly: %', offenders;
  END IF;

  -- MAINTAIN (LOCK TABLE, VACUUM, REINDEX...) exists from Postgres 17 on.
  IF current_setting('server_version_num')::integer >= 170000 THEN
    SELECT string_agg(format('%s %s', r.rolname, c.relname), ', ' ORDER BY c.relname, r.rolname)
      INTO offenders
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'm')
      AND has_table_privilege(r.rolname, c.oid, 'MAINTAIN');
    IF offenders IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL: client roles hold MAINTAIN on: %', offenders;
    END IF;
  END IF;

  -- Rule 2: the requests log. RLS is a per-table setting and privileges are
  -- per-table too; neither is inherited from the partitioned parent, so every
  -- relation in the tree is checked on its own.
  SELECT count(*) INTO leaf_count
  FROM pg_partition_tree('public.requests'::regclass)
  WHERE isleaf;
  IF leaf_count = 0 THEN
    RAISE EXCEPTION 'FAIL: public.requests has no partitions, so rule 2 would pass vacuously';
  END IF;

  SELECT string_agg(
           c.relname || CASE WHEN NOT c.relrowsecurity THEN ' (RLS disabled)'
                             ELSE ' (readable by a client role)' END,
           ', ' ORDER BY c.relname)
    INTO offenders
  FROM pg_class c
  WHERE c.oid IN (SELECT relid FROM pg_partition_tree('public.requests'::regclass)
                  UNION ALL
                  SELECT 'public.requests_fallback'::regclass)
    AND (NOT c.relrowsecurity
         OR has_any_column_privilege('anon', c.oid, 'SELECT')
         OR has_any_column_privilege('authenticated', c.oid, 'SELECT'));
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: requests tables exposed to the Data API: %', offenders;
  END IF;

  -- Rule 3: the RPC surface. Only is_org_member(uuid), and only for
  -- authenticated, because the membership SELECT policies call it.
  SELECT string_agg(format('%s %s', r.rolname, p.oid::regprocedure), ', '
                    ORDER BY r.rolname, p.proname)
    INTO offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
  WHERE n.nspname = 'public'
    AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    AND NOT (r.rolname = 'authenticated'
             AND p.oid = 'public.is_org_member(uuid)'::regprocedure);
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: client roles can call public functions: %', offenders;
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.is_org_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute is_org_member(uuid), so every membership SELECT policy would error';
  END IF;

  -- Rule 4: no permissive write policy for a client role. A permissive ALL
  -- policy counts too unless it is the literal deny (USING false).
  SELECT string_agg(format('%s.%s (%s)', tablename, policyname, cmd), ', '
                    ORDER BY tablename, policyname)
    INTO offenders
  FROM pg_policies
  WHERE schemaname = 'public'
    AND permissive = 'PERMISSIVE'
    AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
    AND (cmd IN ('INSERT', 'UPDATE', 'DELETE')
         OR (cmd = 'ALL' AND coalesce(qual, '') <> 'false'));
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: write policies still open to client roles: %', offenders;
  END IF;

  -- Rule 5: tables created from now on start out the same way. Checked with a
  -- real table rather than by parsing pg_default_acl, so whatever combination
  -- of global and per-schema defaults applies is what gets measured.
  CREATE TABLE public.zz_default_privileges_probe (id integer);
  IF has_table_privilege('anon', 'public.zz_default_privileges_probe', 'INSERT, UPDATE, DELETE, TRUNCATE')
     OR has_table_privilege('authenticated', 'public.zz_default_privileges_probe', 'INSERT, UPDATE, DELETE, TRUNCATE')
  THEN
    RAISE EXCEPTION 'FAIL: a newly created public table is writable by client roles (default privileges)';
  END IF;
  DROP TABLE public.zz_default_privileges_probe;
END $$;

-- Runs stmt and fails unless it is refused with insufficient_privilege by the
-- expected layer: 'row-level security' (layer 2) or 'permission denied'
-- (layer 1). Asserting the layer is what lets each one be tested alone.
CREATE FUNCTION pg_temp.expect_denied(label text, stmt text, layer text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'FAIL %: statement succeeded but should have been refused: %', label, stmt;
EXCEPTION WHEN insufficient_privilege THEN
  IF position(layer IN SQLERRM) = 0 THEN
    RAISE EXCEPTION 'FAIL %: refused, but not by %: %', label, layer, SQLERRM;
  END IF;
END $$;

-- Runs stmt and fails unless it returned or touched exactly `expected` rows.
CREATE FUNCTION pg_temp.expect_rows(label text, stmt text, expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> expected THEN
    RAISE EXCEPTION 'FAIL %: expected % row(s), got %', label, expected, n;
  END IF;
END $$;

-- ── Fixture ──────────────────────────────────────────────────────────────
-- One workspace with an owner (admin) and a viewer, a project, the admin's
-- API key, a provider key nested under it, and one log row. CI resets with
-- --no-seed, so the fixture brings its own users rather than borrowing any.

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dwp-owner@spanlens.test'),
  ('00000000-0000-4000-8000-00000000d002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dwp-viewer@spanlens.test');

INSERT INTO public.organizations (id, name, owner_id)
VALUES ('00000000-0000-4000-8000-00000000d010', 'dwp-workspace',
        '00000000-0000-4000-8000-00000000d001');

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-00000000d010', '00000000-0000-4000-8000-00000000d001', 'admin'),
  ('00000000-0000-4000-8000-00000000d010', '00000000-0000-4000-8000-00000000d002', 'viewer');

INSERT INTO public.projects (id, organization_id, name)
VALUES ('00000000-0000-4000-8000-00000000d020', '00000000-0000-4000-8000-00000000d010',
        'dwp-project');

INSERT INTO public.api_keys (id, project_id, name, key_hash, key_prefix)
VALUES ('00000000-0000-4000-8000-00000000d030', '00000000-0000-4000-8000-00000000d020',
        'dwp-admin-key', 'dwp-admin-key-hash', 'sl_live_dwp');

INSERT INTO public.provider_keys (id, organization_id, api_key_id, provider, name, encrypted_key)
VALUES ('00000000-0000-4000-8000-00000000d040', '00000000-0000-4000-8000-00000000d010',
        '00000000-0000-4000-8000-00000000d030', 'openai', 'dwp-openai', 'dwp-ciphertext');

INSERT INTO public.requests (organization_id, project_id, provider, model)
VALUES ('00000000-0000-4000-8000-00000000d010', '00000000-0000-4000-8000-00000000d020',
        'openai', 'gpt-4o-mini');

-- The partition that row landed in, addressed directly the way pg_graphql
-- exposes it.
SELECT format('public.%I', 'requests_' || to_char(now(), 'YYYY_MM')) AS cur_part \gset

\echo '  1/4 the migrated database satisfies the privilege model'
SELECT pg_temp.assert_privilege_model();

\echo '  2/4 layer 2 alone: with every privilege re-granted, RLS still refuses'
-- Re-create the hosted platform's creation-time grants on top of the
-- migrated state, the way an old setup script or a "reset permissions"
-- button would.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;

-- A month created under those defaults must still come out sealed: RLS on,
-- no client grants. Twelve months ahead guarantees at least one new month
-- however far the partition cron has already run.
CREATE TEMP TABLE new_partitions AS
  SELECT partition_name FROM public.ensure_requests_partitions(12, 0) WHERE created;

DO $$
DECLARE
  created_count integer;
  offenders text;
BEGIN
  SELECT count(*) INTO created_count FROM new_partitions;
  IF created_count = 0 THEN
    RAISE EXCEPTION 'FAIL: ensure_requests_partitions(12, 0) created nothing to inspect';
  END IF;

  SELECT string_agg(np.partition_name, ', ' ORDER BY np.partition_name) INTO offenders
  FROM new_partitions np
  JOIN pg_class c ON c.oid = format('public.%I', np.partition_name)::regclass
  WHERE NOT c.relrowsecurity
     OR has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
     OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE');
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: new partitions were created open to the Data API: %', offenders;
  END IF;
END $$;

SET LOCAL ROLE authenticated;

-- As the owner.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000d001","role":"authenticated"}', true);
SELECT pg_temp.expect_rows('owner reads own workspace',
  $q$SELECT id FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000d010'$q$, 1);
SELECT pg_temp.expect_rows('C2.1 owner cannot upgrade own plan',
  $q$UPDATE public.organizations SET plan = 'enterprise'
     WHERE id = '00000000-0000-4000-8000-00000000d010'$q$, 0);
SELECT pg_temp.expect_denied('C2.1 owner cannot create a workspace directly',
  $q$INSERT INTO public.organizations (name, owner_id, plan)
     VALUES ('forged', '00000000-0000-4000-8000-00000000d001', 'enterprise')$q$,
  'row-level security');

-- As the viewer.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000d002","role":"authenticated"}', true);
SELECT pg_temp.expect_rows('viewer reads projects through is_org_member',
  $q$SELECT id FROM public.projects WHERE id = '00000000-0000-4000-8000-00000000d020'$q$, 1);
SELECT pg_temp.expect_denied('C2.2 viewer cannot mint an API key',
  $q$INSERT INTO public.api_keys (project_id, name, key_hash, key_prefix)
     VALUES ('00000000-0000-4000-8000-00000000d020', 'minted', 'viewer-chosen-hash', 'sl_live_vwr')$q$,
  'row-level security');
SELECT pg_temp.expect_rows('C2.2 viewer cannot deactivate the admin key',
  $q$UPDATE public.api_keys SET is_active = false
     WHERE id = '00000000-0000-4000-8000-00000000d030'$q$, 0);
SELECT pg_temp.expect_rows('C2.2 viewer cannot repoint the provider key',
  $q$UPDATE public.provider_keys SET api_key_id = '00000000-0000-4000-8000-00000000d030'
     WHERE id = '00000000-0000-4000-8000-00000000d040'$q$, 0);
SELECT pg_temp.expect_denied('C2.2 viewer cannot create a dataset',
  $q$INSERT INTO public.datasets (organization_id, name)
     VALUES ('00000000-0000-4000-8000-00000000d010', 'viewer-dataset')$q$,
  'row-level security');
SELECT pg_temp.expect_rows('C2.2 viewer cannot delete the project',
  $q$DELETE FROM public.projects WHERE id = '00000000-0000-4000-8000-00000000d020'$q$, 0);

-- As the anon key, going straight at the partition.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.expect_rows('C2.3 anon reads no log rows through a partition',
  format('SELECT id FROM %s', :'cur_part'), 0);
SELECT pg_temp.expect_denied('C2.3 anon cannot write a log row through a partition',
  format($q$INSERT INTO %s (organization_id, project_id, provider, model)
            VALUES ('00000000-0000-4000-8000-00000000d010',
                    '00000000-0000-4000-8000-00000000d020', 'openai', 'forged')$q$,
         :'cur_part'),
  'row-level security');

RESET ROLE;

\echo '  3/4 enforce_client_privileges() restores layer 1 over those grants'
SELECT public.enforce_client_privileges();
SELECT pg_temp.assert_privilege_model();

\echo '  4/4 layer 1 alone: the same attempts are refused on privileges'
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000d001","role":"authenticated"}', true);
SELECT pg_temp.expect_rows('owner still reads own workspace',
  $q$SELECT id FROM public.organizations WHERE id = '00000000-0000-4000-8000-00000000d010'$q$, 1);
SELECT pg_temp.expect_denied('C2.1 plan upgrade refused on privileges',
  $q$UPDATE public.organizations SET plan = 'enterprise'
     WHERE id = '00000000-0000-4000-8000-00000000d010'$q$,
  'permission denied');

SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000d002","role":"authenticated"}', true);
SELECT pg_temp.expect_rows('viewer still reads projects',
  $q$SELECT id FROM public.projects WHERE id = '00000000-0000-4000-8000-00000000d020'$q$, 1);
SELECT pg_temp.expect_denied('C2.2 key mint refused on privileges',
  $q$INSERT INTO public.api_keys (project_id, name, key_hash, key_prefix)
     VALUES ('00000000-0000-4000-8000-00000000d020', 'minted', 'viewer-chosen-hash', 'sl_live_vwr')$q$,
  'permission denied');
SELECT pg_temp.expect_denied('C2.2 provider key repoint refused on privileges',
  $q$UPDATE public.provider_keys SET api_key_id = '00000000-0000-4000-8000-00000000d030'
     WHERE id = '00000000-0000-4000-8000-00000000d040'$q$,
  'permission denied');
-- The RPC surface is asserted from the catalog only (rule 3), never by
-- calling a revoked function. On supabase/postgres 17.6.1.104 the supautils
-- library segfaults the backend whenever a function call is refused for lack
-- of EXECUTE, and the postmaster then restarts every connection. A test that
-- provoked that would take the whole database down instead of failing.

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.expect_denied('C2.3 anon cannot read a partition at all',
  format('SELECT id FROM %s', :'cur_part'), 'permission denied');

RESET ROLE;

ROLLBACK;

\echo '── direct writes refused on both layers ──'
