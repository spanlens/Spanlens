-- Fix: AVG() returns NULL when all rows have NULL tokens.
-- In that case the TypeScript envelope check (avg > max) evaluates to false
-- (null > number === false in JS) and bypasses the filter entirely — causing
-- recommendations to fire on models where we have no token-volume evidence.
--
-- Using COALESCE(AVG(...), 999999) maps "no token data" to an enormous value
-- that always fails the envelope check, so we conservatively skip the
-- recommendation rather than showing a potentially wrong one.

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
    COUNT(*)                                          AS sample_count,
    COALESCE(AVG(prompt_tokens::float),     999999)  AS avg_prompt_tokens,
    COALESCE(AVG(completion_tokens::float), 999999)  AS avg_completion_tokens,
    COALESCE(SUM(cost_usd), 0)                        AS total_cost_usd
  FROM requests
  WHERE
    organization_id = p_organization_id
    AND created_at  >= p_window_start
    AND status_code = ANY(p_status_codes)
    AND model       IS NOT NULL
    AND provider    IS NOT NULL
  GROUP BY provider, model
$$;
