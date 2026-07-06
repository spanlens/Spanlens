-- Data silence alert episodes (retention improvement, 2026-07-06).
--
-- Tracks "org went quiet" episodes: an org that had steady traffic
-- (>= 50 requests in the 7 days ending 24h ago) but zero requests in the
-- last 24h gets one email per episode. When data resumes the episode is
-- resolved so a future silence can alert again.
--
-- Server-only table: written and read exclusively via supabaseAdmin from
-- the /cron/detect-data-silence job. RLS enabled with no policies so the
-- anon/authenticated roles cannot touch it.

CREATE TABLE IF NOT EXISTS data_silence_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  -- Last request we saw before the silence started (null if unknown).
  last_request_at timestamptz,
  -- Volume in the 7-day window ending 24h before detection. Kept for the
  -- email body and for later tuning of the threshold.
  prior_week_requests integer NOT NULL DEFAULT 0,
  -- True once at least one admin recipient accepted the email. Lets the
  -- cron retry delivery on the next run without opening a new episode.
  email_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One OPEN episode per org — DB-level dedup even if the cron double-fires.
CREATE UNIQUE INDEX IF NOT EXISTS data_silence_alerts_one_open_per_org
  ON data_silence_alerts (organization_id)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS data_silence_alerts_org_idx
  ON data_silence_alerts (organization_id, detected_at DESC);

ALTER TABLE data_silence_alerts ENABLE ROW LEVEL SECURITY;
