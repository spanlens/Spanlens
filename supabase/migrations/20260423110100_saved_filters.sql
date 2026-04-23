-- Per-user named filter bookmarks for the /requests dashboard.
-- Lets users save "prod errors yesterday" type queries and re-apply with one
-- click. Scope is per-user (not org) so each team member has their own list.

CREATE TABLE saved_filters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  /* JSONB: { provider?, model?, status?, projectId?, providerKeyId?, from?, to? } */
  filters         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX saved_filters_user_idx ON saved_filters (user_id);

ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_filters_select" ON saved_filters
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "saved_filters_insert" ON saved_filters
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "saved_filters_delete" ON saved_filters
  FOR DELETE USING (user_id = auth.uid());
