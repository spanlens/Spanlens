-- stats_models: per-model aggregation for the dashboard /models endpoint.
-- Replaces the previous in-memory JS aggregation in apps/server/src/api/stats.ts.
-- Composite index on (organization_id, created_at DESC) already exists from
-- migration 20260422153000_stats_and_security_aggregation_fns.sql.

CREATE OR REPLACE FUNCTION stats_models(
  p_org_id     UUID,
  p_project_id UUID        DEFAULT NULL,
  p_from       TIMESTAMPTZ DEFAULT NULL,
  p_to         TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  provider       TEXT,
  model          TEXT,
  requests       BIGINT,
  total_cost_usd NUMERIC,
  avg_latency_ms NUMERIC,
  error_rate     NUMERIC
)
LANGUAGE sql STABLE AS $$
  SELECT
    provider,
    model,
    COUNT(*)                                                        AS requests,
    COALESCE(SUM(cost_usd), 0)                                      AS total_cost_usd,
    COALESCE(AVG(latency_ms), 0)                                    AS avg_latency_ms,
    COALESCE(
      AVG(CASE WHEN status_code >= 400 THEN 1.0 ELSE 0.0 END), 0
    )                                                               AS error_rate
  FROM requests
  WHERE organization_id = p_org_id
    AND (p_project_id IS NULL OR project_id = p_project_id)
    AND created_at >= COALESCE(p_from, NOW() - INTERVAL '30 days')
    AND created_at <= COALESCE(p_to, NOW())
  GROUP BY provider, model
  ORDER BY total_cost_usd DESC;
$$;
