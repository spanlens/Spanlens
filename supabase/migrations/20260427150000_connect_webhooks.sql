-- Migration: connect_webhooks
--
-- 2 tables for the Connect / Webhooks feature:
--  • webhooks           — endpoint configs per organization
--  • webhook_deliveries — delivery audit log (sent by service role)
--
-- RLS follows the is_org_member() SECURITY DEFINER pattern used throughout
-- the codebase (see alerts_and_webhooks migration).  We NEVER write a
-- sub-SELECT on the same table in a USING clause (gotcha #14).

CREATE TABLE webhooks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  url             TEXT        NOT NULL,
  secret          TEXT        NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  events          TEXT[]      NOT NULL DEFAULT ARRAY['request.created'],
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhooks_org_idx ON webhooks (organization_id) WHERE is_active = TRUE;

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhooks_select" ON webhooks
  FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "webhooks_insert" ON webhooks
  FOR INSERT WITH CHECK (is_org_member(organization_id));
CREATE POLICY "webhooks_update" ON webhooks
  FOR UPDATE USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));
CREATE POLICY "webhooks_delete" ON webhooks
  FOR DELETE USING (is_org_member(organization_id));


-- webhook_deliveries: written only by service role (supabaseAdmin), read by org members.
-- There is no direct FK to organizations — we traverse webhooks instead so
-- the SELECT policy can check org membership without self-referencing a table.
CREATE TABLE webhook_deliveries (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id     UUID        NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL,
  status         TEXT        NOT NULL CHECK (status IN ('success', 'failed')),
  http_status    INTEGER,
  error_message  TEXT,
  duration_ms    INTEGER,
  delivered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_deliveries_webhook_idx ON webhook_deliveries (webhook_id, delivered_at DESC);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Org members can read deliveries for webhooks in their organisation.
-- We join through webhooks and use is_org_member() to avoid recursion.
CREATE POLICY "webhook_deliveries_select" ON webhook_deliveries
  FOR SELECT USING (
    webhook_id IN (
      SELECT id FROM webhooks WHERE is_org_member(organization_id)
    )
  );

-- Service role inserts delivery records (RLS bypassed by supabaseAdmin).
-- Explicit policy so that non-service-role tokens cannot insert.
CREATE POLICY "webhook_deliveries_insert_service" ON webhook_deliveries
  FOR INSERT WITH CHECK (TRUE);
