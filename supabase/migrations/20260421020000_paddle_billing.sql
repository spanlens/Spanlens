-- Migration: paddle_billing
-- Links organizations ↔ Paddle customer / subscription. Writes flow through the
-- webhook handler (service_role); reads from the dashboard via RLS.

-- Nullable: free plan has no Paddle customer yet.
ALTER TABLE organizations
  ADD COLUMN paddle_customer_id TEXT;

CREATE INDEX organizations_paddle_customer_idx
  ON organizations (paddle_customer_id)
  WHERE paddle_customer_id IS NOT NULL;

-- Historical rows are kept on cancel for audit — current status tells us the state.
CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  paddle_subscription_id   TEXT NOT NULL UNIQUE,
  paddle_customer_id       TEXT NOT NULL,
  paddle_price_id          TEXT NOT NULL,

  plan                     TEXT NOT NULL
                             CHECK (plan IN ('starter', 'team', 'enterprise')),
  status                   TEXT NOT NULL
                             CHECK (status IN ('active', 'trialing', 'past_due', 'paused', 'canceled')),

  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,

  metadata                 JSONB,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_org_idx ON subscriptions (organization_id);
CREATE INDEX subscriptions_status_idx ON subscriptions (status) WHERE status IN ('active', 'trialing');

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select" ON subscriptions
  FOR SELECT USING (is_org_member(organization_id));

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
