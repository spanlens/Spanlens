-- The org_members SELECT policy from 20260425000000_org_members.sql
-- self-referenced the same table:
--
--   USING ( organization_id IN
--           (SELECT organization_id FROM org_members WHERE user_id = auth.uid()) )
--
-- PostgreSQL detects this as infinite recursion and fails the query with
-- 42P17 ("infinite recursion detected in policy"). Server-side calls go
-- through supabaseAdmin (service_role, RLS bypass) so the bug never
-- surfaced for the dashboard UI; but any client-side `from('org_members')`
-- query — or even an incidental REST API hit — blows up.
--
-- Replace with a simple self-row policy: each authenticated user can read
-- ONLY their own org_members rows (used to check "what workspaces am I in?"
-- without leaking other members' membership). Listing teammates of an org
-- continues to go through the server's GET /api/v1/organizations/:id/members
-- endpoint, which uses service_role and enforces is_org_member() in app code.

DROP POLICY IF EXISTS "org_members_select" ON org_members;

CREATE POLICY "org_members_select_self" ON org_members
  FOR SELECT USING (user_id = auth.uid());
