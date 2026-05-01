-- Batch sparkline RPC for prompt quality timeseries.
--
-- Returns bucketed quality scores (0-100) for N prompt names in a single
-- round-trip. Used by the prompts list page to render inline sparklines
-- without N+1 queries.
--
-- Quality score per bucket = 100 * (1 - error_rate)
-- where error_rate = requests with status_code >= 400 / total requests.
-- Buckets with no data return null so the sparkline can render gaps.

CREATE OR REPLACE FUNCTION public.get_prompts_quality_sparklines(
  p_org_id   uuid,
  p_names    text[],
  p_hours    int  DEFAULT 24,
  p_buckets  int  DEFAULT 20
)
RETURNS TABLE (
  prompt_name    text,
  bucket_index   int,
  bucket_start   timestamptz,
  quality_score  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- time bounds
  bounds AS (
    SELECT
      now() - (p_hours || ' hours')::interval AS since,
      now()                                    AS until
  ),
  -- all version ids for the requested prompt names, scoped to org
  version_ids AS (
    SELECT pv.id, pv.name
    FROM   prompt_versions pv
    WHERE  pv.organization_id = p_org_id
      AND  pv.name            = ANY(p_names)
  ),
  -- requests in window
  reqs AS (
    SELECT
      vi.name                AS prompt_name,
      r.created_at,
      r.status_code
    FROM   requests r
    JOIN   version_ids vi ON vi.id = r.prompt_version_id
    CROSS  JOIN bounds b
    WHERE  r.organization_id = p_org_id
      AND  r.created_at     >= b.since
      AND  r.created_at     <  b.until
  ),
  -- assign bucket index (0 = oldest, p_buckets-1 = newest)
  bucketed AS (
    SELECT
      prompt_name,
      floor(
        extract(epoch FROM (reqs.created_at - b.since)) /
        (extract(epoch FROM (b.until - b.since)) / p_buckets)
      )::int AS bidx,
      status_code
    FROM reqs
    CROSS JOIN bounds b
  ),
  -- aggregate per (name, bucket)
  agg AS (
    SELECT
      prompt_name,
      bidx,
      count(*)                                              AS total,
      count(*) FILTER (WHERE status_code >= 400)            AS errors
    FROM bucketed
    WHERE bidx BETWEEN 0 AND p_buckets - 1
    GROUP BY prompt_name, bidx
  )
  SELECT
    agg.prompt_name,
    agg.bidx                                    AS bucket_index,
    bounds.since + (
      agg.bidx::numeric / p_buckets *
      extract(epoch FROM (bounds.until - bounds.since)) * interval '1 second'
    )                                           AS bucket_start,
    round(
      100.0 * (1.0 - agg.errors::numeric / agg.total),
      1
    )                                           AS quality_score
  FROM agg
  CROSS JOIN bounds
  ORDER BY agg.prompt_name, agg.bidx;
$$;

COMMENT ON FUNCTION public.get_prompts_quality_sparklines IS
  'Batch sparkline data: bucketed quality scores (0-100) for multiple prompt names.';
