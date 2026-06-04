-- Migration: organizations.hide_powered_by_badge
--
-- PLG Loop ②: Team-plan and above can remove the "Observed by Spanlens"
-- footer from their public share pages (loop ①). Free / Starter cannot —
-- the badge is the compounding distribution mechanism for those tiers, and
-- removing it is the upgrade hook into Team.
--
-- Gate enforcement is in the server, not the DB: the flag may be true even
-- on a downgraded org, but the share viewer only honours it while the org
-- sits on team or enterprise. This keeps re-upgrades zero-touch (the saved
-- preference reactivates) without leaking the badge-removal benefit to a
-- mid-cycle downgrade.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS hide_powered_by_badge BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.hide_powered_by_badge IS
  'PLG Loop ② — Team+ only. Server enforces the plan gate at share render time; the column may be true on a downgraded org but is ignored until the plan returns to team/enterprise.';
