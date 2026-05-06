-- Returns the total cost_usd for a specific (provider, model) in a bounded time window.
--
-- Used by the recommendation engine to detect when a model swap has been adopted:
-- a ≥70% drop in spend vs the prior comparable window is treated as "achieved".
--
-- Model matching uses boundary-aware prefix so that dated variants (e.g.
-- gpt-4o-2024-08-06) are covered when the caller passes the canonical alias (gpt-4o).
-- In practice callers pass the exact model string returned by get_model_aggregates,
-- so the LIKE arm also catches any other dated variant of the same family.
CREATE OR REPLACE FUNCTION get_model_prior_window_cost(
  p_organization_id uuid,
  p_provider        text,
  p_model           text,
  p_window_start    timestamptz,
  p_window_end      timestamptz
)
RETURNS double precision
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(cost_usd), 0)::double precision
  FROM requests
  WHERE organization_id = p_organization_id
    AND provider        = p_provider
    AND (model = p_model OR model LIKE (p_model || '-%'))
    AND created_at >= p_window_start
    AND created_at <  p_window_end
    AND status_code = ANY(ARRAY[200, 201, 202, 204])
$$;
