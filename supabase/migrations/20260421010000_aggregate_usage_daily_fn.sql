-- Migration: aggregate_usage_daily_fn
-- RPC function that rolls up `requests` rows into `usage_daily` for a given date.
-- Called hourly by the Vercel cron at /cron/aggregate-usage.
--
-- Safe to call multiple times per day — ON CONFLICT on the usage_daily
-- UNIQUE(organization_id, project_id, date, provider, model) makes the
-- upsert idempotent. Later hourly runs simply overwrite with the latest
-- totals.

CREATE OR REPLACE FUNCTION aggregate_usage_daily(target_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  row_count INTEGER;
BEGIN
  INSERT INTO usage_daily (
    organization_id, project_id, date, provider, model,
    request_count, prompt_tokens, completion_tokens, total_tokens, cost_usd
  )
  SELECT
    organization_id,
    project_id,
    target_date AS date,
    provider,
    model,
    COUNT(*) AS request_count,
    COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
    COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
    COALESCE(SUM(total_tokens), 0) AS total_tokens,
    COALESCE(SUM(cost_usd), 0) AS cost_usd
  FROM requests
  WHERE created_at >= target_date::timestamptz
    AND created_at <  (target_date + INTERVAL '1 day')::timestamptz
    AND status_code < 400
    AND model IS NOT NULL
    AND model <> ''
  GROUP BY organization_id, project_id, provider, model
  ON CONFLICT (organization_id, project_id, date, provider, model)
  DO UPDATE SET
    request_count     = EXCLUDED.request_count,
    prompt_tokens     = EXCLUDED.prompt_tokens,
    completion_tokens = EXCLUDED.completion_tokens,
    total_tokens      = EXCLUDED.total_tokens,
    cost_usd          = EXCLUDED.cost_usd,
    updated_at        = now();

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;
