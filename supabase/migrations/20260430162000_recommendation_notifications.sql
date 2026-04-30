-- Tracks which high-confidence recommendations have had a notification sent.
-- The UNIQUE (organization_id, recommendation_key) ensures at most one
-- notification per recommendation per org (idempotent cron runs).

CREATE TABLE recommendation_notifications (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recommendation_key  text          NOT NULL,
  confidence_level    text          NOT NULL CHECK (confidence_level IN ('high', 'medium', 'low')),
  savings_usd         numeric(10,2) NOT NULL,
  sent_at             timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (organization_id, recommendation_key)
);

ALTER TABLE recommendation_notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_rec_notifs_org
  ON recommendation_notifications (organization_id, sent_at DESC);
