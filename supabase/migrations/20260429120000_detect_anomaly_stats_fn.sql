-- DB-side aggregation for anomaly detection.
--
-- Replaces the previous pattern of fetching all raw rows into Node.js memory
-- and computing mean/stddev in JavaScript. Instead, PostgreSQL computes the
-- aggregates in a single GROUP BY scan and returns one row per (provider, model).
--
-- Parameters:
--   p_org_id     — organization to scope the query
--   p_ref_start  — start of reference window (e.g. now - 7d)
--   p_obs_start  — start of observation window (e.g. now - 1h); rows before
--                  this timestamp are the reference set
--   p_project_id — optional project scope (NULL = all projects)
--
-- Latency + cost are aggregated over success-only rows (status_code < 400)
-- so that a 500-storm doesn't poison the latency/cost baseline.
-- Error rate is aggregated over all rows (Bernoulli proportion).

CREATE OR REPLACE FUNCTION detect_anomaly_stats(
  p_org_id      UUID,
  p_ref_start   TIMESTAMPTZ,
  p_obs_start   TIMESTAMPTZ,
  p_project_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  provider            TEXT,
  model               TEXT,
  -- Latency (success-only)
  obs_latency_mean    DOUBLE PRECISION,
  obs_latency_count   BIGINT,
  ref_latency_mean    DOUBLE PRECISION,
  ref_latency_stddev  DOUBLE PRECISION,
  ref_latency_count   BIGINT,
  -- Cost (success-only)
  obs_cost_mean       DOUBLE PRECISION,
  obs_cost_count      BIGINT,
  ref_cost_mean       DOUBLE PRECISION,
  ref_cost_stddev     DOUBLE PRECISION,
  ref_cost_count      BIGINT,
  -- Error rate (all rows)
  obs_error_rate      DOUBLE PRECISION,
  obs_all_count       BIGINT,
  ref_error_rate      DOUBLE PRECISION,
  ref_error_stddev    DOUBLE PRECISION,
  ref_all_count       BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.provider,
    r.model,
    -- ── Latency ────────────────────────────────────────────────────────────
    AVG(r.latency_ms)         FILTER (WHERE r.created_at >= p_obs_start
                                        AND r.status_code < 400
                                        AND r.latency_ms  IS NOT NULL)::DOUBLE PRECISION,
    COUNT(r.latency_ms)       FILTER (WHERE r.created_at >= p_obs_start
                                        AND r.status_code < 400
                                        AND r.latency_ms  IS NOT NULL),
    AVG(r.latency_ms)         FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.latency_ms  IS NOT NULL)::DOUBLE PRECISION,
    STDDEV_SAMP(r.latency_ms) FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.latency_ms  IS NOT NULL)::DOUBLE PRECISION,
    COUNT(r.latency_ms)       FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.latency_ms  IS NOT NULL),
    -- ── Cost ───────────────────────────────────────────────────────────────
    AVG(r.cost_usd)           FILTER (WHERE r.created_at >= p_obs_start
                                        AND r.status_code < 400
                                        AND r.cost_usd    IS NOT NULL)::DOUBLE PRECISION,
    COUNT(r.cost_usd)         FILTER (WHERE r.created_at >= p_obs_start
                                        AND r.status_code < 400
                                        AND r.cost_usd    IS NOT NULL),
    AVG(r.cost_usd)           FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.cost_usd    IS NOT NULL)::DOUBLE PRECISION,
    STDDEV_SAMP(r.cost_usd)   FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.cost_usd    IS NOT NULL)::DOUBLE PRECISION,
    COUNT(r.cost_usd)         FILTER (WHERE r.created_at <  p_obs_start
                                        AND r.status_code < 400
                                        AND r.cost_usd    IS NOT NULL),
    -- ── Error rate ─────────────────────────────────────────────────────────
    AVG(CASE WHEN r.status_code >= 400 THEN 1.0 ELSE 0.0 END)
                              FILTER (WHERE r.created_at >= p_obs_start)::DOUBLE PRECISION,
    COUNT(*)                  FILTER (WHERE r.created_at >= p_obs_start),
    AVG(CASE WHEN r.status_code >= 400 THEN 1.0 ELSE 0.0 END)
                              FILTER (WHERE r.created_at <  p_obs_start)::DOUBLE PRECISION,
    STDDEV_SAMP(CASE WHEN r.status_code >= 400 THEN 1.0 ELSE 0.0 END)
                              FILTER (WHERE r.created_at <  p_obs_start)::DOUBLE PRECISION,
    COUNT(*)                  FILTER (WHERE r.created_at <  p_obs_start)
  FROM requests r
  WHERE r.organization_id = p_org_id
    AND r.created_at       >= p_ref_start
    AND r.model             IS NOT NULL
    AND (p_project_id IS NULL OR r.project_id = p_project_id)
  GROUP BY r.provider, r.model
$$;
