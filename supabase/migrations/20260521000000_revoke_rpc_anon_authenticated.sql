-- CRITICAL #1: Lock down SECURITY DEFINER RPCs that should never be callable
-- from public PostgREST (anon / authenticated). All real callers use
-- supabaseAdmin (service_role) which bypasses these grants.
--
-- Verified call sites (2026-05-21):
--   aggregate_usage_daily       — apps/server/src/api/cron.ts (supabaseAdmin)
--   prune_logs_by_retention     — apps/server/src/api/cron.ts (supabaseAdmin)
--   prune_rate_limit_buckets    — apps/server/src/api/cron.ts (supabaseAdmin)
--   get_model_aggregates        — apps/server/src/lib/model-recommend.ts (supabaseAdmin)
--   get_model_prior_window_cost — apps/server/src/lib/model-recommend.ts (supabaseAdmin)
--   get_model_percentiles       — apps/server/src/api/recommendations.ts (supabaseAdmin)
--   link_otlp_span_parents      — apps/server/src/api/otlp.ts (supabaseAdmin)
--   set_spanlens_actor          — apps/server/src/api/admin/modelPrices.ts (supabaseAdmin)
--   check_rate_limit            — unused (TS checkRateLimit in lib/rate-limit.ts is the live impl)
--   get_prompts_quality_sparklines — unused
--
-- is_org_member is intentionally NOT revoked from authenticated — 17+ RLS
-- policies on protected tables call it during policy evaluation, which
-- requires EXECUTE in the caller's role context.

REVOKE EXECUTE ON FUNCTION public.aggregate_usage_daily(date)          FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_logs_by_retention()            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_rate_limit_buckets()           FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_model_aggregates(uuid, timestamptz, integer[])              FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_model_percentiles(uuid, text, text, timestamptz)            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_model_prior_window_cost(uuid, text, text, timestamptz, timestamptz) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_prompts_quality_sparklines(uuid, text[], integer, integer)  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_otlp_span_parents(uuid)         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_spanlens_actor(uuid)             FROM anon, authenticated;

-- is_org_member: drop anon only (it's needed by authenticated RLS policy eval)
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM anon;
