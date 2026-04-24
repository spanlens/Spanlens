-- Migration: anomaly_acks
-- Tracks which live anomalies the user has acknowledged so the UI can
-- suppress or de-emphasize them until they re-fire with new data.

CREATE TABLE anomaly_acks (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('latency', 'cost', 'error_rate')),
  acknowledged_by UUID REFERENCES auth.users(id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, provider, model, kind)
);

ALTER TABLE anomaly_acks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anomaly_acks_select" ON anomaly_acks FOR SELECT
  USING (is_org_member(organization_id));
CREATE POLICY "anomaly_acks_insert" ON anomaly_acks FOR INSERT
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "anomaly_acks_update" ON anomaly_acks FOR UPDATE
  USING (is_org_member(organization_id));
CREATE POLICY "anomaly_acks_delete" ON anomaly_acks FOR DELETE
  USING (is_org_member(organization_id));
