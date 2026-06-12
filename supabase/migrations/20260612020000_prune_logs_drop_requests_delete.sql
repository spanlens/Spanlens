-- Cron fix — prune-logs `relation "requests" does not exist` since 2026-05-15.
--
-- The `prune_logs_by_retention()` function still issues `DELETE FROM requests`
-- inside its per-org loop. The `requests` table was dropped from Postgres in
-- Phase 5.1 (gotcha #3) and moved to ClickHouse; the function has been failing
-- on every daily cron tick since.
--
-- ClickHouse handles request log retention two ways now:
--   1. `requests` table TTL = 365d (set in clickhouse/migrations/001_create_requests.sql)
--      caps every row at the longest non-Enterprise plan window.
--   2. Application-layer clipping via `requestsScope(orgId)` in
--      `apps/server/src/lib/requests-query.ts` enforces the actual per-plan
--      retention (Free 14d, Pro 90d, Team 365d) at query time so older rows
--      are never visible to the dashboard. See gotcha #3 / CLAUDE.md.
--
-- That leaves the Postgres-only tables for this function to manage: `traces`
-- and `alert_deliveries`. `spans` follows `traces` via FK ON DELETE CASCADE.
-- The return JSON keeps `deleted_requests` for API compatibility but always
-- reports 0 — the cron caller renders it raw and dropping the key would
-- break the dashboard widget.
--
-- CREATE OR REPLACE so re-running is safe; the prior body is replaced
-- atomically without dropping dependent grants.
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
      retention_days := CASE r.plan
        WHEN 'free' THEN 7
        WHEN 'starter' THEN 30
        WHEN 'team' THEN 90
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
