-- Fix: stats_timeseries always bucketed at day granularity regardless of the
-- selected time range. 1h / 24h views showed a single daily bucket instead of
-- per-hour data points, making the chart nearly useless for short ranges.
--
-- Changes:
--   • Add p_granularity TEXT DEFAULT 'day' parameter.
--     Server auto-selects 'hour' for ranges ≤ 48h, 'day' otherwise.
--   • Return type of `day` changed from DATE → TIMESTAMPTZ so that hourly
--     buckets carry time information (e.g. "2026-04-28T14:00:00+00:00").
--     Existing callers that do r.day.slice(0,10) continue to work.

CREATE OR REPLACE FUNCTION stats_timeseries(
  p_org_id     UUID,
  p_project_id UUID        DEFAULT NULL,
  p_from       TIMESTAMPTZ DEFAULT NULL,
  p_to         TIMESTAMPTZ DEFAULT NULL,
  p_granularity TEXT       DEFAULT 'day'
) RETURNS TABLE (
  day       TIMESTAMPTZ,
  requests  BIGINT,
  cost      NUMERIC,
  tokens    BIGINT,
  errors    BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    date_trunc(p_granularity, created_at)          AS day,
    COUNT(*)                                        AS requests,
    COALESCE(SUM(cost_usd), 0)                      AS cost,
    COALESCE(SUM(total_tokens), 0)                  AS tokens,
    COUNT(*) FILTER (WHERE status_code >= 400)      AS errors
  FROM requests
  WHERE organization_id = p_org_id
    AND (p_project_id IS NULL OR project_id = p_project_id)
    AND created_at >= COALESCE(p_from, NOW() - INTERVAL '30 days')
    AND created_at <= COALESCE(p_to, NOW())
  GROUP BY 1
  ORDER BY 1;
$$;
