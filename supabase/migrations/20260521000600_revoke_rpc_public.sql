-- CRITICAL #1 follow-up: The first REVOKE migration only revoked from
-- anon/authenticated, but Postgres default privileges grant EXECUTE to
-- PUBLIC on every new function. anon/authenticated inherit from PUBLIC
-- so the advisor lint still flagged them.
--
-- This revokes from PUBLIC across all SECURITY DEFINER functions that
-- should be service_role-only. `is_org_member` keeps its explicit
-- `authenticated` grant (verified by previous query) — needed for RLS
-- policy evaluation.

REVOKE EXECUTE ON FUNCTION public.aggregate_usage_daily(date)                                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_logs_by_retention()                                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_rate_limit_buckets()                                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer)                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_model_aggregates(uuid, timestamptz, integer[])             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_model_percentiles(uuid, text, text, timestamptz)           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_model_prior_window_cost(uuid, text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_prompts_quality_sparklines(uuid, text[], integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_otlp_span_parents(uuid)                                   FROM PUBLIC;

-- is_org_member: keep authenticated grant (RLS dependency), drop PUBLIC
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC;
