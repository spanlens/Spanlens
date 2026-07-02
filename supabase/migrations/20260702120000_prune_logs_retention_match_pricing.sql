-- Fix prune retention to match the published pricing page.
--
-- `prune_logs_by_retention()` (last defined in 20260612020000) hard-deletes
-- Postgres-only tables (`traces`, `spans` via FK cascade, `alert_deliveries`)
-- on a per-org cadence keyed on `organizations.plan`. Its CASE used the OLD
-- retention windows:
--
--     free=7d, starter=30d, team=90d, enterprise=365d
--
-- Those numbers under-deliver against every other source of truth:
--   * pricing page + apps/web/lib/billing-plans.ts  PLAN_RETENTION_DAYS
--   * apps/server/src/lib/quota.ts                  LOG_RETENTION_DAYS
--   * requests-query.ts requestsScope() (ClickHouse) query-time clipping
--
-- all of which promise:
--
--     free=14d, starter(Pro)=90d, team=365d, enterprise=365d
--
-- Net effect of the bug: a Free user's agent traces vanished at day 7 though
-- the page promised 14; Pro at 30 vs 90; Team at 90 vs 365. `requests`
-- (ClickHouse) were already correct via TTL + requestsScope; only the
-- Postgres trace/delivery tables were pruned early. This aligns them.
--
-- CREATE OR REPLACE so re-running is safe and dependent grants are preserved.
CREATE OR REPLACE FUNCTION prune_logs_by_retention()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_traces     INT := 0;
  deleted_deliveries INT := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, plan FROM organizations
  LOOP
    DECLARE
      retention_days INT;
      cutoff TIMESTAMPTZ;
      row_count INT;
    BEGIN
      -- Must match LOG_RETENTION_DAYS in apps/server/src/lib/quota.ts and
      -- PLAN_RETENTION_DAYS in apps/web/lib/billing-plans.ts.
      retention_days := CASE r.plan
        WHEN 'free' THEN 14
        WHEN 'starter' THEN 90
        WHEN 'team' THEN 365
        ELSE 365
      END;
      cutoff := now() - (retention_days || ' days')::interval;

      DELETE FROM traces WHERE organization_id = r.id AND created_at < cutoff;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      deleted_traces := deleted_traces + row_count;

      DELETE FROM alert_deliveries WHERE organization_id = r.id AND created_at < cutoff;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      deleted_deliveries := deleted_deliveries + row_count;
    END;
  END LOOP;

  RETURN json_build_object(
    'deleted_requests', 0,                       -- retained via ClickHouse TTL + requestsScope
    'deleted_traces',   deleted_traces,
    'deleted_spans',    0,                       -- cascaded via FK ON DELETE CASCADE on traces
    'deleted_alert_deliveries', deleted_deliveries
  );
END;
$$;
