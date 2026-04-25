-- stats_overview: single-row aggregate for the dashboard overview cards.
-- Called by GET /api/v1/stats/overview.
CREATE OR REPLACE FUNCTION stats_overview(
  p_org_id    UUID,
  p_project_id UUID DEFAULT NULL,
  p_from      TIMESTAMPTZ DEFAULT NULL,
  p_to        TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  total_requests     BIGINT,
  success_requests   BIGINT,
  error_requests     BIGINT,
  total_cost_usd     NUMERIC,
  total_tokens       BIGINT,
  prompt_tokens      BIGINT,
  completion_tokens  BIGINT,
  avg_latency_ms     NUMERIC
)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)                                                      AS total_requests,
    COUNT(*) FILTER (WHERE status_code < 400)                     AS success_requests,
    COUNT(*) FILTER (WHERE status_code >= 400)                    AS error_requests,
    COALESCE(SUM(cost_usd), 0)                                    AS total_cost_usd,
    COALESCE(SUM(total_tokens), 0)                                AS total_tokens,
    COALESCE(SUM(prompt_tokens), 0)                               AS prompt_tokens,
    COALESCE(SUM(completion_tokens), 0)                           AS completion_tokens,
    COALESCE(AVG(latency_ms), 0)                                  AS avg_latency_ms
  FROM requests
  WHERE organization_id = p_org_id
    AND (p_project_id IS NULL OR project_id = p_project_id)
    AND created_at >= COALESCE(p_from, NOW() - INTERVAL '30 days')
    AND created_at <= COALESCE(p_to, NOW());
$$;

-- security_summary: counts flagged requests by flag type and pattern.
-- Called by GET /api/v1/security/summary.
-- flags column is JSONB array of objects: [{type, pattern, sample}, ...]
CREATE OR REPLACE FUNCTION security_summary(
  p_org_id UUID,
  p_hours  INT DEFAULT 24
) RETURNS TABLE (
  flag_type TEXT,
  pattern   TEXT,
  count     BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    (flag->>'type')::text    AS flag_type,
    (flag->>'pattern')::text AS pattern,
    COUNT(*)                 AS count
  FROM requests,
       LATERAL jsonb_array_elements(flags) AS flag
  WHERE organization_id = p_org_id
    AND jsonb_array_length(flags) > 0
    AND created_at >= NOW() - (p_hours || ' hours')::INTERVAL
  GROUP BY 1, 2
  ORDER BY count DESC;
$$;
