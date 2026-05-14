-- ─────────────────────────────────────────────────────────────────────────────
-- get_user_analytics — aggregate per-user usage for /api/v1/users
--
-- Returns one row per distinct user_id within an organization, with totals
-- (requests, tokens, cost), behavior (avg latency, error count, distinct
-- models), and lifetime markers (first_seen, last_seen).
--
-- The total_count column carries the COUNT(*) OVER () windowed total so the
-- list endpoint can paginate without a second roundtrip.
--
-- Indexes already cover the hot filter:
--   idx_requests_user_id ON (organization_id, user_id, created_at DESC)
--     WHERE user_id IS NOT NULL  -- added in 20260513040000_requests_user_session.sql
--
-- Sort whitelist (p_sort_by): 'cost' | 'requests' | 'tokens' | 'last_seen'.
-- Anything else falls back to 'cost'. Direction whitelist: 'asc' | 'desc'.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_analytics(
  p_org_id      uuid,
  p_project_id  uuid,
  p_search      text,
  p_from        timestamptz,
  p_to          timestamptz,
  p_sort_by     text,
  p_sort_dir    text,
  p_limit       int,
  p_offset      int
)
RETURNS TABLE (
  user_id          text,
  total_requests   bigint,
  total_tokens     bigint,
  total_cost_usd   numeric,
  avg_latency_ms   numeric,
  first_seen       timestamptz,
  last_seen        timestamptz,
  error_requests   bigint,
  distinct_models  bigint,
  total_count      bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sort_col text;
  v_sort_dir text;
BEGIN
  -- Whitelist sort inputs to prevent SQL injection.
  v_sort_col := CASE p_sort_by
    WHEN 'requests'  THEN 'total_requests'
    WHEN 'tokens'    THEN 'total_tokens'
    WHEN 'last_seen' THEN 'last_seen'
    ELSE 'total_cost_usd'
  END;
  v_sort_dir := CASE WHEN lower(coalesce(p_sort_dir, 'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;

  RETURN QUERY EXECUTE format($q$
    WITH grouped AS (
      SELECT
        r.user_id                                         AS user_id,
        COUNT(*)::bigint                                  AS total_requests,
        COALESCE(SUM(r.total_tokens), 0)::bigint          AS total_tokens,
        COALESCE(SUM(r.cost_usd), 0)::numeric             AS total_cost_usd,
        AVG(r.latency_ms)::numeric                        AS avg_latency_ms,
        MIN(r.created_at)                                 AS first_seen,
        MAX(r.created_at)                                 AS last_seen,
        COUNT(*) FILTER (WHERE r.status_code >= 400)::bigint AS error_requests,
        COUNT(DISTINCT r.model)::bigint                   AS distinct_models
      FROM requests r
      WHERE r.organization_id = $1
        AND r.user_id IS NOT NULL
        AND ($2::uuid IS NULL OR r.project_id = $2)
        AND ($3::text IS NULL OR r.user_id ILIKE '%%' || $3 || '%%')
        AND ($4::timestamptz IS NULL OR r.created_at >= $4)
        AND ($5::timestamptz IS NULL OR r.created_at <= $5)
      GROUP BY r.user_id
    )
    SELECT
      g.*,
      COUNT(*) OVER ()::bigint AS total_count
    FROM grouped g
    ORDER BY %I %s NULLS LAST
    LIMIT $6 OFFSET $7
  $q$, v_sort_col, v_sort_dir)
  USING p_org_id, p_project_id, p_search, p_from, p_to, p_limit, p_offset;
END;
$$;

COMMENT ON FUNCTION get_user_analytics(uuid, uuid, text, timestamptz, timestamptz, text, text, int, int) IS
  'Aggregate per-user usage stats for an organization. Used by GET /api/v1/users.';

GRANT EXECUTE ON FUNCTION get_user_analytics(uuid, uuid, text, timestamptz, timestamptz, text, text, int, int)
  TO authenticated, service_role;
