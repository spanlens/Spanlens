-- Security/notification settings for stale-key reminders and leak detection.
--
-- Both features are notification-only — no auto-revoke. Stale-key reminders
-- run as a weekly digest; leak detection runs daily and emails immediately
-- on the first scan that returns "leaked" for a given key (dedup via the
-- new provider_key_leak_scans table).

ALTER TABLE organizations
  ADD COLUMN stale_key_alerts_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN stale_key_threshold_days INTEGER NOT NULL DEFAULT 90
    CHECK (stale_key_threshold_days BETWEEN 30 AND 365),
  ADD COLUMN leak_detection_enabled   BOOLEAN NOT NULL DEFAULT false;

-- One row per scan attempt. `result='leaked'` rows with non-null notified_at
-- mean we already emailed admins for this incident — subsequent scans of
-- the same still-leaked key won't re-spam.
CREATE TABLE provider_key_leak_scans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key_id UUID NOT NULL REFERENCES provider_keys(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  result          TEXT NOT NULL CHECK (result IN ('clean', 'leaked', 'error')),
  notified_at     TIMESTAMPTZ,
  details         JSONB
);

CREATE INDEX idx_pkls_key_time ON provider_key_leak_scans(provider_key_id, scanned_at DESC);
CREATE INDEX idx_pkls_org_time ON provider_key_leak_scans(organization_id, scanned_at DESC);

ALTER TABLE provider_key_leak_scans ENABLE ROW LEVEL SECURITY;

-- Members can read their org's scan history. All writes go through the
-- service-role admin client in the cron handler — no INSERT/UPDATE/DELETE
-- policies needed (deny-by-default for non-admin roles).
CREATE POLICY "leak_scans_select" ON provider_key_leak_scans FOR SELECT
  USING (is_org_member(organization_id));

-- Index hint for the stale-key digest cron, which does
-- MAX(created_at) GROUP BY provider_key_id over `requests`. We already index
-- (organization_id, created_at), but provider_key_id alone helps when the
-- workspace has lots of requests across many keys.
CREATE INDEX IF NOT EXISTS idx_requests_provider_key_id_created_at
  ON requests(provider_key_id, created_at DESC)
  WHERE provider_key_id IS NOT NULL;
