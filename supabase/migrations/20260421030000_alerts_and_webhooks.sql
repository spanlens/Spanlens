-- Migration: alerts_and_webhooks
--
-- 3 tables for the alerting pipeline:
--  • alerts                  — threshold configs (budget / error_rate / latency_p95)
--  • notification_channels   — delivery targets (email / slack / discord)
--  • alert_deliveries        — audit log of sends (for dedup + debugging)
--
-- Evaluator cron (GitHub Actions → /cron/evaluate-alerts) reads alerts,
-- queries requests/usage_daily to compute current metric, compares to
-- threshold, and POSTs to every active channel. cooldown_minutes prevents
-- spam; last_triggered_at is stamped on each fire.

CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('budget', 'error_rate', 'latency_p95')),

  threshold       NUMERIC NOT NULL,
  window_minutes  INTEGER NOT NULL DEFAULT 60,

  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  last_triggered_at   TIMESTAMPTZ,
  cooldown_minutes    INTEGER NOT NULL DEFAULT 60,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alerts_org_idx ON alerts (organization_id) WHERE is_active = TRUE;
CREATE INDEX alerts_project_idx ON alerts (project_id) WHERE project_id IS NOT NULL;

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alerts_select" ON alerts FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "alerts_insert" ON alerts FOR INSERT WITH CHECK (is_org_member(organization_id));
CREATE POLICY "alerts_update" ON alerts FOR UPDATE
  USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
CREATE POLICY "alerts_delete" ON alerts FOR DELETE USING (is_org_member(organization_id));

CREATE TRIGGER alerts_updated_at BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


CREATE TABLE notification_channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  kind            TEXT NOT NULL CHECK (kind IN ('email', 'slack', 'discord')),
  target          TEXT NOT NULL,   -- email: address; slack/discord: webhook URL

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notification_channels_org_idx ON notification_channels (organization_id)
  WHERE is_active = TRUE;

ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channels_select" ON notification_channels
  FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "channels_insert" ON notification_channels
  FOR INSERT WITH CHECK (is_org_member(organization_id));
CREATE POLICY "channels_update" ON notification_channels
  FOR UPDATE USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "channels_delete" ON notification_channels
  FOR DELETE USING (is_org_member(organization_id));

CREATE TRIGGER channels_updated_at BEFORE UPDATE ON notification_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


CREATE TABLE alert_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  alert_id        UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel_id      UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,

  status          TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message   TEXT,
  payload         JSONB,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alert_deliveries_alert_idx ON alert_deliveries (alert_id, created_at DESC);

ALTER TABLE alert_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deliveries_select" ON alert_deliveries
  FOR SELECT USING (is_org_member(organization_id));
