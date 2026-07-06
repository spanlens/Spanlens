-- Atomic view-count increment for public shares (2026-07-06).
-- Backs apps/server/src/api/publicShare.ts, which switched from a
-- read-modify-write `.update({ view_count: share.view_count + 1 })` (a
-- lost-update race under concurrent viewers) to this atomic RPC. supabase-js
-- `.update()` cannot express `view_count = view_count + 1`, so the increment
-- must live in SQL. Called only via supabaseAdmin (service_role), fire-and-forget.
CREATE OR REPLACE FUNCTION public.increment_share_view_count(p_token text)
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$
  UPDATE public.shared_links SET view_count = view_count + 1 WHERE token = p_token;
$$;

-- Lock the RPC down to the server. shared_links is deny-by-default RLS; this
-- function is only ever invoked by supabaseAdmin (service_role, which bypasses
-- RLS). Revoke the default PUBLIC EXECUTE so an anon/authenticated caller can't
-- inflate view counts through PostgREST (the RLS-M1 lesson from the same review).
REVOKE EXECUTE ON FUNCTION public.increment_share_view_count(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_share_view_count(text) TO service_role;
