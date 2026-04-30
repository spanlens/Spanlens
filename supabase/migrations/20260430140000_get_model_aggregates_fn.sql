-- Aggregate model usage stats for the recommendation engine.
--
-- Why a function instead of fetching raw rows:
--   The Supabase JS client applies a 1000-row default limit on .select() calls.
--   For orgs with >1000 requests in the analysis window this silently truncates
--   data, producing wrong sampleCount values and potentially missed/wrong
--   recommendations. Doing GROUP BY in the DB eliminates the problem entirely
--   and is also much faster (no round-trip of raw rows into JS memory).

CREATE OR REPLACE FUNCTION get_model_aggregates(
  p_organization_id uuid,
  p_window_start     timestamptz,
  p_status_codes     int[]
)
RETURNS TABLE (
  provider               text,
  model                  text,
  sample_count           bigint,
  avg_prompt_tokens      double precision,
  avg_completion_tokens  double precision,
  total_cost_usd         double precision
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    provider,
    model,
    COUNT(*)                          AS sample_count,
    AVG(prompt_tokens::float)         AS avg_prompt_tokens,
    AVG(completion_tokens::float)     AS avg_completion_tokens,
    COALESCE(SUM(cost_usd), 0)        AS total_cost_usd
  FROM requests
  WHERE
    organization_id = p_organization_id
    AND created_at  >= p_window_start
    AND status_code = ANY(p_status_codes)
    AND model       IS NOT NULL
    AND provider    IS NOT NULL
  GROUP BY provider, model
$$;
