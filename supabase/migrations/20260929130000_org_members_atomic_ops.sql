-- Atomic membership operations + exact member email lookup (2026-09-29).
--
-- Three defects in apps/server/src/api/{members,invitations}.ts shared one
-- root cause: every membership decision was a read in one PostgREST call and
-- a write in another, with nothing holding the roster still in between.
--
--   1. Last-admin protection (C5.1). PATCH/DELETE counted admins, then issued
--      a separate UPDATE/DELETE. Two admins demoting each other concurrently
--      both read "2 admins", both wrote, and the workspace ended up with zero
--      admins: billing, members and security settings locked for good, with
--      no in-app recovery.
--   2. Seat limits (C5.2). SEAT_LIMITS was declared but never enforced. The
--      join-time check has to see the member count and insert under the same
--      lock, or two invitees accepting at once both pass a "2 of 3 seats" read.
--   3. Member emails (C5.3). The roster and the invite dedup called
--      auth.admin.listUsers({ perPage: 200 }), which is the first page of the
--      whole Auth project, not of the org. Past 200 signups, members showed as
--      "(unknown)" and existing members could be re-invited.
--
-- Locking: each write takes a transaction-scoped advisory lock keyed on the
-- org, then re-reads under it. READ COMMITTED gives every statement a fresh
-- snapshot, so the read after the lock sees whatever the previous holder
-- committed. An advisory lock (rather than a row lock on organizations) keeps
-- FK checks and plan updates on the organizations row out of the queue. The
-- key is 64-bit (hashtextextended), so unrelated orgs effectively never share
-- a lock.
--
-- All functions are SECURITY DEFINER with a pinned search_path and are callable
-- only by service_role (supabaseAdmin). The roster functions read auth.users,
-- which must never be reachable from anon/authenticated via PostgREST.
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT can be re-run safely.

-- ── Role change with last-admin protection ───────────────────────────────────
-- Returns { status, previous_role } where status is one of:
--   ok | unchanged | not_found | last_admin
CREATE OR REPLACE FUNCTION public.org_change_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_new_role public.org_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current public.org_role;
  v_admins integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('org_members:' || p_org_id::text, 0));

  SELECT role INTO v_current
  FROM public.org_members
  WHERE organization_id = p_org_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_current = p_new_role THEN
    RETURN jsonb_build_object('status', 'unchanged', 'previous_role', v_current);
  END IF;

  IF v_current = 'admin' AND p_new_role <> 'admin' THEN
    SELECT count(*) INTO v_admins
    FROM public.org_members
    WHERE organization_id = p_org_id AND role = 'admin';

    IF v_admins <= 1 THEN
      RETURN jsonb_build_object('status', 'last_admin', 'previous_role', v_current);
    END IF;
  END IF;

  UPDATE public.org_members
  SET role = p_new_role
  WHERE organization_id = p_org_id AND user_id = p_user_id;

  RETURN jsonb_build_object('status', 'ok', 'previous_role', v_current);
END;
$$;

-- ── Member removal with last-admin protection ────────────────────────────────
-- Returns { status, removed_role } where status is one of:
--   ok | not_found | last_admin
CREATE OR REPLACE FUNCTION public.org_remove_member(
  p_org_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current public.org_role;
  v_admins integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('org_members:' || p_org_id::text, 0));

  SELECT role INTO v_current
  FROM public.org_members
  WHERE organization_id = p_org_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_current = 'admin' THEN
    SELECT count(*) INTO v_admins
    FROM public.org_members
    WHERE organization_id = p_org_id AND role = 'admin';

    IF v_admins <= 1 THEN
      RETURN jsonb_build_object('status', 'last_admin', 'removed_role', v_current);
    END IF;
  END IF;

  DELETE FROM public.org_members
  WHERE organization_id = p_org_id AND user_id = p_user_id;

  RETURN jsonb_build_object('status', 'ok', 'removed_role', v_current);
END;
$$;

-- ── Invitation accept with an atomic seat check ──────────────────────────────
-- p_seat_limit is the org's seat allowance, resolved by the server from
-- SEAT_LIMITS (apps/server/src/lib/quota.ts, the single source of truth).
-- NULL means unlimited (Enterprise, or an instance that does not sell seats).
-- The limit only gates NEW members: an org already above it after a downgrade
-- keeps everyone, and a user who is already a member just has the invitation
-- marked accepted.
--
-- The server validates the token/id and the invitee's email before calling;
-- accepted_at and expires_at are re-checked here under the lock because a
-- concurrent accept can land between that read and this call.
--
-- Returns { status, organization_id, role, members?, seat_limit? } where
-- status is one of:
--   joined | already_member | not_found | already_accepted | expired | seat_limit
CREATE OR REPLACE FUNCTION public.org_accept_invitation(
  p_invitation_id uuid,
  p_user_id uuid,
  p_seat_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id uuid;
  v_inv public.org_invitations%ROWTYPE;
  v_members integer;
  v_is_member boolean;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM public.org_invitations
  WHERE id = p_invitation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('org_members:' || v_org_id::text, 0));

  SELECT * INTO v_inv
  FROM public.org_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_accepted', 'organization_id', v_inv.organization_id);
  END IF;

  IF v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('status', 'expired', 'organization_id', v_inv.organization_id);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE organization_id = v_inv.organization_id AND user_id = p_user_id
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    IF p_seat_limit IS NOT NULL THEN
      SELECT count(*) INTO v_members
      FROM public.org_members
      WHERE organization_id = v_inv.organization_id;

      IF v_members >= p_seat_limit THEN
        RETURN jsonb_build_object(
          'status', 'seat_limit',
          'organization_id', v_inv.organization_id,
          'members', v_members,
          'seat_limit', p_seat_limit
        );
      END IF;
    END IF;

    INSERT INTO public.org_members (organization_id, user_id, role, invited_by)
    VALUES (v_inv.organization_id, p_user_id, v_inv.role, v_inv.invited_by);
  END IF;

  UPDATE public.org_invitations
  SET accepted_at = now()
  WHERE id = p_invitation_id;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_is_member THEN 'already_member' ELSE 'joined' END,
    'organization_id', v_inv.organization_id,
    'role', v_inv.role
  );
END;
$$;

-- ── Exact member email lookup ─────────────────────────────────────────────────
-- One row per member of the org, with the auth email (NULL if the auth row is
-- somehow missing, so the roster never silently drops a member). Replaces the
-- project-wide listUsers page for both the roster and the invite dedup.
CREATE OR REPLACE FUNCTION public.org_member_emails(p_org_id uuid)
RETURNS TABLE (user_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT m.user_id, u.email::text
  FROM public.org_members m
  LEFT JOIN auth.users u ON u.id = m.user_id
  WHERE m.organization_id = p_org_id
  ORDER BY m.created_at;
$$;

-- ── Lock every function down to the server ───────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC on every new function, and Supabase's
-- default privileges add anon/authenticated. Without these revokes any signed
-- in user could POST /rest/v1/rpc/org_change_member_role and promote
-- themselves, or read another org's member emails.
REVOKE EXECUTE ON FUNCTION public.org_change_member_role(uuid, uuid, public.org_role)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.org_remove_member(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.org_accept_invitation(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.org_member_emails(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.org_change_member_role(uuid, uuid, public.org_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_remove_member(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_accept_invitation(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_member_emails(uuid) TO service_role;
