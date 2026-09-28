-- Execution claim for the soft-delete queue (2026-09-29).
--
-- The restore endpoint and the hard-delete cron used to race (C5.4):
--   * the cron SELECTed a batch of due rows, then hard-deleted each one without
--     re-checking it, so a restore that finished in between was followed by a
--     hard delete anyway. The UI said "restored" while the prompt version was
--     gone.
--   * restore reactivated the resource first and only then stamped
--     cancelled_at, so the cron could delete between the two steps and restore
--     still answered 200.
--
-- Both paths now claim the row with a conditional UPDATE before touching the
-- resource. Restore claims by setting cancelled_at (terminal). The cron claims
-- by setting execution_claimed_at, deletes, then stamps executed_at. Each
-- claim requires the other side's marker to be absent, so exactly one of them
-- wins.
--
-- Why a separate claim column instead of stamping executed_at up front: if the
-- function dies between the claim and the delete, an early executed_at would
-- record a deletion that never happened, and nothing would ever retry it. A
-- claim older than the lease (15 minutes, enforced in
-- apps/server/src/api/pendingDeletions.ts) is treated as abandoned, so the
-- next cron run picks the row up again. The hard delete is idempotent.
--
-- Additive and idempotent: nullable column, no backfill, no rewrite.
ALTER TABLE public.pending_deletions
  ADD COLUMN IF NOT EXISTS execution_claimed_at timestamptz;

COMMENT ON COLUMN public.pending_deletions.execution_claimed_at IS
  'Set by the hard-delete cron when it claims a due row, before deleting the resource. Restore refuses rows with a live claim; a claim older than the lease is considered abandoned.';
