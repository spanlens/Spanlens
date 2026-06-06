-- 20260606000000_pending_deletions.sql
--
-- Soft delete queue for high-risk resources (api_keys, provider_keys,
-- prompt_versions). Instead of hard-deleting on user request we record a
-- pending deletion with a 72-hour grace window, flip `is_active=false` on
-- the source row so traffic stops immediately, and let a cron job execute
-- the hard delete after the window expires.
--
-- Why we need this:
--   • Accidental key revocation is the #1 inbound support ticket pattern in
--     this category. A user clicks "Delete" on the wrong key and every
--     production call starts returning 401 until they rotate.
--   • Prompt rollback through deletion is a footgun — a referenced version
--     can vanish out from under a running A/B experiment.
--
-- Why a separate table (not a `deleted_at` column on each source row):
--   • Resources live in three different tables with different ownership
--     models. A unified queue keeps the restore UI and the cleanup cron
--     in one place.
--   • A user-friendly "Trash" page needs a single source of truth that
--     ranks pending deletions by time-remaining regardless of resource type.
--
-- evals.evaluators is intentionally NOT covered here: it already uses
-- `archived_at` for soft delete, and the eval workflow has separate semantics
-- (archived evaluators stay queryable for historical scoring, which a
-- generic pending_deletions row can't express).

CREATE TABLE IF NOT EXISTS pending_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Discriminator + opaque pointer to the source row. We intentionally do
  -- not enforce FK on resource_id because the resource may be hard-deleted
  -- after the grace window; the snapshot below is then the only record.
  resource_type TEXT NOT NULL CHECK (
    resource_type IN ('api_key', 'provider_key', 'prompt_version')
  ),
  resource_id UUID NOT NULL,

  -- Full row snapshot at the time of deletion request. Used by the restore
  -- path to recreate state if hard delete already executed AND by the
  -- audit log so admins can see exactly what was deleted.
  resource_snapshot JSONB NOT NULL,

  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- When the cron job is allowed to execute the hard delete. Default policy
  -- is 72 hours from requested_at; the API will set this explicitly so future
  -- per-resource policies (e.g. enterprise: 7 days) can ship without a
  -- second migration.
  scheduled_for TIMESTAMPTZ NOT NULL,

  -- One of cancelled_at / executed_at gets stamped when the row leaves
  -- the "active" state. We keep both columns so the audit trail records
  -- which path the row took.
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ,

  CONSTRAINT pending_deletions_terminal_states CHECK (
    (cancelled_at IS NULL OR executed_at IS NULL)
  )
);

-- One active pending deletion per (resource_type, resource_id, org). Re-
-- delete attempts hit the duplicate insert and the API translates that to
-- a 409 instead of silently creating a second row.
CREATE UNIQUE INDEX IF NOT EXISTS pending_deletions_active_uniq
  ON pending_deletions (resource_type, resource_id, organization_id)
  WHERE cancelled_at IS NULL AND executed_at IS NULL;

-- Cron picks up due rows in scheduled_for order.
CREATE INDEX IF NOT EXISTS pending_deletions_scheduled_idx
  ON pending_deletions (scheduled_for)
  WHERE cancelled_at IS NULL AND executed_at IS NULL;

-- Trash UI lists by org + recency.
CREATE INDEX IF NOT EXISTS pending_deletions_org_recent_idx
  ON pending_deletions (organization_id, requested_at DESC);

ALTER TABLE pending_deletions ENABLE ROW LEVEL SECURITY;

-- Members of the org can list / restore. Writes go through the server with
-- service_role so we don't need INSERT/UPDATE policies for end users.
CREATE POLICY pending_deletions_select ON pending_deletions
  FOR SELECT USING (is_org_member(organization_id));

-- Explicit deny-all for anon + authenticated on write paths. The server
-- uses supabaseAdmin (service_role) which bypasses RLS.
CREATE POLICY pending_deletions_deny_writes ON pending_deletions
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Allow service_role inserts/updates explicitly so the restrictive policy
-- above doesn't block legitimate server writes when RLS is forced on.
CREATE POLICY pending_deletions_service_role_all ON pending_deletions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
