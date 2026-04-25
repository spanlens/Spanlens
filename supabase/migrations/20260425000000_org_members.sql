-- Multi-user organizations: org_members + invitations + per-user dismissals.
--
-- Before this migration, `organizations.owner_id` was the single user allowed
-- into an org. This migration introduces a proper membership table with roles
-- (admin/editor/viewer), and rewrites `is_org_member()` to check it.
--
-- Existing owners are backfilled as admins so nothing breaks for current users.
-- organizations.owner_id is kept for now — it still points at the org creator
-- and is used as an anchor for backfill + a fast "who created this" shortcut.
-- A future cleanup can drop it once all code paths have migrated.

-- ────────────────────────────────────────────────────────────
-- 1. org_role enum
-- ────────────────────────────────────────────────────────────
CREATE TYPE org_role AS ENUM ('admin', 'editor', 'viewer');

-- ────────────────────────────────────────────────────────────
-- 2. org_members (membership + role)
-- ────────────────────────────────────────────────────────────
CREATE TABLE org_members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            org_role NOT NULL DEFAULT 'viewer',
  invited_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_org_role ON org_members(organization_id, role);

-- Backfill: every existing org owner becomes an admin in the new table.
INSERT INTO org_members (organization_id, user_id, role)
SELECT id, owner_id, 'admin'::org_role
FROM organizations
ON CONFLICT DO NOTHING;

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- Read: anyone in the same org can see all members (for the team list).
CREATE POLICY "org_members_select" ON org_members
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    )
  );

-- Write: locked down in RLS — the server uses service_role for these ops
-- and enforces role checks (admin-only) + last-admin protection in app code.
-- We do NOT grant INSERT/UPDATE/DELETE to authenticated users here: going
-- through supabaseAdmin is the single code path, which keeps the logic
-- centralized and avoids RLS-bypass footguns.

-- ────────────────────────────────────────────────────────────
-- 3. Rewrite is_org_member() to consult org_members
--    (replaces the owner_id check in the initial schema)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_org_member(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE organization_id = org_id AND user_id = auth.uid()
  )
$$;

-- ────────────────────────────────────────────────────────────
-- 4. org_invitations (email-based, 7-day expiry)
--    token_hash is sha256(token). The raw token lives only in the
--    emailed URL — never in the DB. That way a DB leak can't be
--    turned into working invite links.
-- ────────────────────────────────────────────────────────────
CREATE TABLE org_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            org_role NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  invited_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitations_org_pending
  ON org_invitations(organization_id)
  WHERE accepted_at IS NULL;

CREATE INDEX idx_invitations_email_pending
  ON org_invitations(lower(email))
  WHERE accepted_at IS NULL;

ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;

-- Members of the org can see pending invitations for their org.
CREATE POLICY "invitations_select" ON org_invitations
  FOR SELECT USING (is_org_member(organization_id));

-- Writes go through supabaseAdmin + server-side role check (admin-only).

-- ────────────────────────────────────────────────────────────
-- 5. attn_dismissals — per-user dismiss state for dashboard
--    "Needs attention" cards. A dismissed card stays hidden for
--    THAT user only, in every browser, forever (until the card_key
--    changes, e.g. a new anomaly appears).
-- ────────────────────────────────────────────────────────────
CREATE TABLE attn_dismissals (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_key        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, card_key)
);

CREATE INDEX idx_attn_dismissals_user
  ON attn_dismissals(user_id, organization_id);

ALTER TABLE attn_dismissals ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own dismissals only.
CREATE POLICY "attn_dismissals_select_own" ON attn_dismissals
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "attn_dismissals_insert_own" ON attn_dismissals
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND is_org_member(organization_id)
  );

CREATE POLICY "attn_dismissals_delete_own" ON attn_dismissals
  FOR DELETE USING (user_id = auth.uid());
