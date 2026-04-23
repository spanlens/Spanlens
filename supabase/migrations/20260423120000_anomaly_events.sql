-- Persisted snapshot of anomalies detected by the daily cron. Lets the
-- dashboard show "anomaly history over the last N days" — patterns like
-- "every Tuesday at lunchtime gpt-4o latency spikes" become visible.
--
-- Idempotency: each (org, day, provider, model, kind) combo gets at most
-- ONE row per day. The cron's UPSERT relies on the unique constraint.

CREATE TABLE anomaly_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  detected_on     DATE NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('latency', 'cost', 'error_rate')),
  current_value   NUMERIC NOT NULL,
  baseline_mean   NUMERIC NOT NULL,
  baseline_stddev NUMERIC NOT NULL,
  deviations      NUMERIC NOT NULL,
  sample_count    INTEGER NOT NULL,
  reference_count INTEGER NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, detected_on, provider, model, kind)
);

CREATE INDEX anomaly_events_org_date_idx
  ON anomaly_events (organization_id, detected_on DESC);

ALTER TABLE anomaly_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anomaly_events_select" ON anomaly_events
  FOR SELECT USING (is_org_member(organization_id));
-- writes: service_role only (no INSERT/UPDATE/DELETE policy)
