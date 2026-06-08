-- Migration: extend internal_alerts.kind CHECK with 'cron_failure'
--
-- /cron/self-monitor (added in the same PR) scans cron_job_runs for
-- failures over the last hour and writes an internal_alerts row when
-- it finds one. That row needs a kind value the CHECK constraint
-- accepts, so we extend it from the original four to five.
--
-- The original migration (20260609110000_internal_alerts.sql) used an
-- inline CHECK, which PostgreSQL auto-named — we don't know whether
-- the live name is `internal_alerts_kind_check` or some other slug
-- depending on Postgres version, so we use a DO block to look it up
-- through pg_constraint instead of hard-coding a DROP CONSTRAINT name.
-- Same pattern documented in R-7's evaluators_type_check_extend plan.

DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'public.internal_alerts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%missing_model_prices%';

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE internal_alerts DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE internal_alerts ADD CONSTRAINT internal_alerts_kind_check
  CHECK (kind IN (
    'missing_model_prices',
    'orphan_spans',
    'fallback_queue_high',
    'webhook_backlog',
    'cron_failure'
  ));

COMMENT ON COLUMN internal_alerts.kind IS
  'Alert family. ''cron_failure'' added 2026-06-09 for /cron/self-monitor. Adding a new family requires extending the CHECK constraint plus code; do not stuff free-form text here.';
