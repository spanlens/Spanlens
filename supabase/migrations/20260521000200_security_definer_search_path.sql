-- CRITICAL #3: Pin search_path on SECURITY DEFINER functions to mitigate
-- CVE-2018-1058-style schema-hijacking. The same fix also applies to
-- trigger functions (non-DEFINER) that lint flagged as mutable.
--
-- `pg_catalog` first guarantees the built-in operators resolve correctly
-- even if a caller injects a same-named function into `public`. `public`
-- second lets these functions reach app tables without explicit prefix.

ALTER FUNCTION public.aggregate_usage_daily(date)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.prune_logs_by_retention()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.prune_rate_limit_buckets()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.check_rate_limit(text, text, integer)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.link_otlp_span_parents(uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_org_member(uuid)
  SET search_path = pg_catalog, public;

-- Non-DEFINER trigger functions still benefit from a pinned path
ALTER FUNCTION public.update_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_user_profiles_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.human_evals_set_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.log_model_price_change()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.refresh_trace_aggregates()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.prune_cron_job_runs()
  SET search_path = pg_catalog, public;
