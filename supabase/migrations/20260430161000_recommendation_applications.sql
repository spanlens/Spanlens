-- Track when organizations apply a cost-saving recommendation.
-- Shows "Applied N days ago" badges in the Savings dashboard.

CREATE TABLE recommendation_applications (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id            uuid        NOT NULL,
  provider           text        NOT NULL,
  model              text        NOT NULL,
  suggested_provider text        NOT NULL,
  suggested_model    text        NOT NULL,
  applied_at         timestamptz NOT NULL DEFAULT now(),
  note               text
);

ALTER TABLE recommendation_applications ENABLE ROW LEVEL SECURITY;

-- Service-role (supabaseAdmin) handles all writes via the server.
-- This policy allows org members to read their own application records
-- for direct Supabase client queries (currently unused, good hygiene).
CREATE POLICY "users can select their own applications"
  ON recommendation_applications
  FOR SELECT
  USING (user_id = auth.uid());

-- Fast lookups by org + model pair
CREATE INDEX idx_rec_apps_org_model
  ON recommendation_applications (organization_id, provider, model, suggested_provider, suggested_model);

-- Sorted list by recency for the dashboard
CREATE INDEX idx_rec_apps_org_applied
  ON recommendation_applications (organization_id, applied_at DESC);
