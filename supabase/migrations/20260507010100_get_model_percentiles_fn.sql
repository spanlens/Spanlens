-- Returns P50 / P95 / P99 token distribution for a specific (provider, model)
-- within the analysis window.
--
-- Used by GET /api/v1/recommendations/percentiles, lazy-fetched only when the
-- Savings "Simulate" dialog opens. Lets the UI show how the org's actual token
-- distribution compares to the substitute model's envelope, and warn when P95
-- exceeds the envelope (suggesting some requests may degrade in quality).
--
-- percentile_cont requires ordered-set aggregation in SQL — pulling raw rows
-- into JS would be impractical for high-traffic models (100k+ rows).
CREATE OR REPLACE FUNCTION get_model_percentiles(
  p_organization_id uuid,
  p_provider        text,
  p_model           text,
  p_window_start    timestamptz
)
RETURNS TABLE (
  p50_prompt     double precision,
  p95_prompt     double precision,
  p99_prompt     double precision,
  p50_completion double precision,
  p95_completion double precision,
  p99_completion double precision,
  sample_count   bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    percentile_cont(0.50) WITHIN GROUP (ORDER BY prompt_tokens::float)     AS p50_prompt,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY prompt_tokens::float)     AS p95_prompt,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY prompt_tokens::float)     AS p99_prompt,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY completion_tokens::float) AS p50_completion,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY completion_tokens::float) AS p95_completion,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY completion_tokens::float) AS p99_completion,
    COUNT(*)::bigint                                                        AS sample_count
  FROM requests
  WHERE organization_id = p_organization_id
    AND provider        = p_provider
    AND (model = p_model OR model LIKE (p_model || '-%'))
    AND created_at >= p_window_start
    AND status_code = ANY(ARRAY[200, 201, 202, 204])
    AND prompt_tokens     IS NOT NULL
    AND completion_tokens IS NOT NULL
$$;
