-- Track cron job execution history for the Settings → System monitor.
-- No org scoping — system-level table, accessed only via service_role.

CREATE TABLE IF NOT EXISTS cron_job_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name     TEXT        NOT NULL,
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT        NOT NULL CHECK (status IN ('ok', 'error')),
  duration_ms  INTEGER,
  error_message TEXT
);

ALTER TABLE cron_job_runs ENABLE ROW LEVEL SECURITY;
-- Deny all direct client access; only supabaseAdmin (service_role) reads/writes.
CREATE POLICY "deny_all" ON cron_job_runs USING (false);

-- Index for the "latest run per job" query pattern
CREATE INDEX IF NOT EXISTS cron_job_runs_job_name_ran_at_idx
  ON cron_job_runs (job_name, ran_at DESC);

-- Auto-prune: keep only the last 90 days of run history
CREATE OR REPLACE FUNCTION prune_cron_job_runs() RETURNS void LANGUAGE sql AS $$
  DELETE FROM cron_job_runs WHERE ran_at < now() - INTERVAL '90 days';
$$;
