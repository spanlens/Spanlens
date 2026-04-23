-- Fix: stats_timeseries returned empty when from/to were passed as NULL.
--
-- The original function used `created_at >= p_from` directly. When the
-- caller passes p_from = NULL, Postgres evaluates `created_at >= NULL` as
-- NULL (not TRUE), so the WHERE clause filters out every row → empty result.
--
-- The default values (`DEFAULT (NOW() - INTERVAL '30 days')`) only apply
-- when the parameter is OMITTED — passing explicit NULL bypasses them. The
-- server code does `p_from: from ?? null`, which always passes NULL when
-- the query string is absent, so the defaults never kicked in for the
-- common case (dashboard home with no filters).
--
-- Fix: COALESCE inside the function. Handles both omitted-params and
-- explicit-null-params, falling back to the same "last 30 days" range the
-- pre-RPC JS implementation used.
--
-- Verified post-deploy: stats_timeseries(<org_id>, NULL, NULL, NULL)
-- returns the expected daily aggregates again.

CREATE OR REPLACE FUNCTION stats_timeseries(
  p_org_id UUID,
  p_project_id UUID DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  day       DATE,
  requests  BIGINT,
  cost      NUMERIC,
  tokens    BIGINT,
  errors    BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    date_trunc('day', created_at)::date                  AS day,
    COUNT(*)                                             AS requests,
    COALESCE(SUM(cost_usd), 0)                           AS cost,
    COALESCE(SUM(total_tokens), 0)                       AS tokens,
    COUNT(*) FILTER (WHERE status_code >= 400)           AS errors
  FROM requests
  WHERE organization_id = p_org_id
    AND (p_project_id IS NULL OR project_id = p_project_id)
    AND created_at >= COALESCE(p_from, NOW() - INTERVAL '30 days')
    AND created_at <= COALESCE(p_to, NOW())
  GROUP BY 1
  ORDER BY 1;
$$;
