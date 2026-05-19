-- ─────────────────────────────────────────────────────────────────────────────
-- anomaly_events.confidence — statistical reliability label (P3.2).
--
-- WHY: Before P3.2 the anomaly detector required ≥30 reference samples to
-- surface anything. New customers (first week of traffic) saw no anomalies
-- because the historical window was too thin. P3.2 lowers the gate to 10
-- samples and tags each row with a confidence level so the dashboard can
-- render low-confidence findings less prominently.
--
-- Existing rows: NULL → reasonable default. The cron rewrites all anomaly
-- rows daily on each detected_on UTC date, so within 24h every live row
-- will have a populated confidence. Backfill is not attempted; the column
-- nullability lets old rows coexist without ALTER pain.
--
-- IDEMPOTENT (`ADD COLUMN IF NOT EXISTS`).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE anomaly_events
  ADD COLUMN IF NOT EXISTS confidence TEXT
    CHECK (confidence IN ('low', 'medium', 'high'));

COMMENT ON COLUMN anomaly_events.confidence IS
  'Statistical reliability tier based on reference_count. low=10..29, medium=30..99, high=100+. Pre-P3.2 rows are NULL until the next daily snapshot rewrites them.';
