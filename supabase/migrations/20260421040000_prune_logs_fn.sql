-- Migration: prune_logs_fn
-- Called daily by /cron/prune-logs to enforce plan retention:
--   free=7d, starter=30d, team=90d, enterprise=365d

CREATE OR REPLACE FUNCTION prune_logs_by_retention()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_requests INT := 0;
  deleted_spans    INT := 0;
  deleted_traces   INT := 0;
  deleted_deliveries INT := 0;
  r RECORD;
BEGIN
  FOR r IN SELECT id, plan FROM organizations LOOP
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

      DELETE FROM requests WHERE organization_id = r.id AND created_at < cutoff;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      deleted_requests := deleted_requests + row_count;

      DELETE FROM traces WHERE organization_id = r.id AND created_at < cutoff;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      deleted_traces := deleted_traces + row_count;

      DELETE FROM alert_deliveries WHERE organization_id = r.id AND created_at < cutoff;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      deleted_deliveries := deleted_deliveries + row_count;
    END;
  END LOOP;

  RETURN json_build_object(
    'deleted_requests', deleted_requests,
    'deleted_traces',   deleted_traces,
    'deleted_spans',    deleted_spans,
    'deleted_alert_deliveries', deleted_deliveries
  );
END;
$$;
