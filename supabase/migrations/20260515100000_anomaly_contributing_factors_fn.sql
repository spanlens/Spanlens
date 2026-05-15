-- Computes contributing factor data for a specific (provider, model) anomaly.
-- Returns token averages for both the observation and reference windows,
-- plus a distribution of error status codes in the observation window.
-- Called once per detected anomaly to explain WHY the anomaly occurred.

CREATE OR REPLACE FUNCTION get_anomaly_factors(
  p_org_id     UUID,
  p_provider   TEXT,
  p_model      TEXT,
  p_obs_start  TIMESTAMPTZ,
  p_ref_start  TIMESTAMPTZ,
  p_project_id UUID DEFAULT NULL
)
RETURNS TABLE (
  obs_prompt_tokens_mean     DOUBLE PRECISION,
  ref_prompt_tokens_mean     DOUBLE PRECISION,
  obs_completion_tokens_mean DOUBLE PRECISION,
  ref_completion_tokens_mean DOUBLE PRECISION,
  obs_total_tokens_mean      DOUBLE PRECISION,
  ref_total_tokens_mean      DOUBLE PRECISION,
  obs_status_distribution    JSONB
)
LANGUAGE sql
STABLE
AS $$
  WITH token_stats AS (
    SELECT
      AVG(CASE WHEN created_at >= p_obs_start THEN prompt_tokens::float8     END) AS obs_pt,
      AVG(CASE WHEN created_at <  p_obs_start THEN prompt_tokens::float8     END) AS ref_pt,
      AVG(CASE WHEN created_at >= p_obs_start THEN completion_tokens::float8 END) AS obs_ct,
      AVG(CASE WHEN created_at <  p_obs_start THEN completion_tokens::float8 END) AS ref_ct,
      AVG(CASE WHEN created_at >= p_obs_start THEN total_tokens::float8      END) AS obs_tt,
      AVG(CASE WHEN created_at <  p_obs_start THEN total_tokens::float8      END) AS ref_tt
    FROM requests
    WHERE organization_id = p_org_id
      AND provider        = p_provider
      AND model           = p_model
      AND created_at     >= p_ref_start
      AND (p_project_id IS NULL OR project_id = p_project_id)
  ),
  error_dist AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object('code', status_code, 'count', cnt)
        ORDER BY cnt DESC
      ),
      '[]'::jsonb
    ) AS dist
    FROM (
      SELECT status_code, COUNT(*) AS cnt
      FROM requests
      WHERE organization_id = p_org_id
        AND provider        = p_provider
        AND model           = p_model
        AND created_at     >= p_obs_start
        AND status_code    >= 400
        AND (p_project_id IS NULL OR project_id = p_project_id)
      GROUP BY status_code
      ORDER BY cnt DESC
      LIMIT 5
    ) sc
  )
  SELECT
    ts.obs_pt, ts.ref_pt,
    ts.obs_ct, ts.ref_ct,
    ts.obs_tt, ts.ref_tt,
    ed.dist
  FROM token_stats ts, error_dist ed;
$$;
