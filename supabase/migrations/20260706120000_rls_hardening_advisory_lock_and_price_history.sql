-- Post-launch RLS hardening (2026-07-06).
-- Two gaps surfaced by the pre-launch security review, both introduced AFTER
-- the 2026-05-21 revoke-rpc-public sweep (20260521000600) and therefore missed
-- by it. Both fixes are idempotent.

-- ── 1. Advisory-lock RPCs left EXECUTE-able by PUBLIC (unauthenticated DoS) ───
-- 20260608030000_background_migrations.sql created
-- try_advisory_lock_for_migration / release_advisory_lock_for_migration as
-- SECURITY DEFINER and GRANTed EXECUTE to service_role, but never revoked the
-- default PUBLIC EXECUTE that Postgres grants on every new function. Any anon /
-- authenticated caller can therefore hit them via PostgREST
-- (POST /rest/v1/rpc/try_advisory_lock_for_migration) and squat the
-- background-migration advisory lock (789456123, hashtext(name)), stalling the
-- /cron/run-background-migrations runner indefinitely. This is the exact gap the
-- 20260521000600 sweep closed for the older RPCs.
REVOKE EXECUTE ON FUNCTION public.try_advisory_lock_for_migration(text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_advisory_lock_for_migration(text)
  FROM PUBLIC, anon, authenticated;

-- Pin search_path for consistency with the other SECURITY DEFINER helpers
-- (20260521000200). The bodies only call pg_catalog builtins, so this is
-- belt-and-suspenders, not a live injection fix.
ALTER FUNCTION public.try_advisory_lock_for_migration(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.release_advisory_lock_for_migration(text)
  SET search_path = pg_catalog, public;

-- ── 2. model_price_history admin SELECT policy effectively public ─────────────
-- 20260519000000 (re-affirmed verbatim in 20260521000400) created
-- "model_price_history_admin_select" with a subquery that checks whether the
-- caller is an admin of ANY org — no organization constraint. Since every
-- self-service signup becomes admin of their own workspace, the policy resolves
-- to "any authenticated user", exposing the global price-change audit trail
-- (including changed_by, which holds internal Spanlens operator auth.users
-- UUIDs). model_price_history is a platform-global table with no org scope and
-- is only ever read server-side via supabaseAdmin (the /admin/model-prices UI
-- goes through the server). Drop the policy and rely on service_role: RLS-on +
-- zero policies = deny-all for anon/authenticated, matching the
-- background_migrations / internal_alerts pattern. supabaseAdmin (service_role)
-- bypasses RLS, so server reads are unaffected.
DROP POLICY IF EXISTS "model_price_history_admin_select" ON model_price_history;
