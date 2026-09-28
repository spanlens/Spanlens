-- ─────────────────────────────────────────────────────────────────────────────
-- subscription_overage_charges: a 'charged' row must record what it charged.
--
-- WHY (review of the 2026-09-28 billing fixes, follow-up to 20260929110300):
--   The true-up charges final_quantity - sum(charged_quantity). The runbook
--   for needs_reconciliation rows, and for legacy 'error' rows where Paddle
--   did charge, is to set status = 'charged' TOGETHER WITH charged_quantity.
--   The original ledger migration (20260422140000) only told operators to
--   flip the status. An operator who follows that older note leaves
--   charged_quantity at 0, and the next settlement bills the whole period
--   again, including the part Paddle already collected.
--
-- WHAT:
--   CHECK (status <> 'charged' OR overage_quantity = 0 OR charged_quantity > 0).
--   A status-only UPDATE now fails with 23514 instead of arming a double
--   charge. A row that owed nothing (overage_quantity = 0) may still be
--   'charged' with charged_quantity = 0. The settlement pass also refuses to
--   true up a period holding such a row (paddle-overage-ledger.ts), so the
--   guard holds even where this constraint is not deployed yet.
--
--   Rows the previous migration backfilled already satisfy the check. The
--   same backfill is repeated here, scoped to the provisional rows it covered,
--   so adding the constraint cannot fail on a row written in between.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.subscription_overage_charges
   SET charged_quantity = overage_quantity
 WHERE status = 'charged'
   AND kind = 'provisional'
   AND charged_quantity = 0
   AND overage_quantity > 0;

ALTER TABLE public.subscription_overage_charges
  DROP CONSTRAINT IF EXISTS subscription_overage_charges_charged_has_quantity;
ALTER TABLE public.subscription_overage_charges
  ADD CONSTRAINT subscription_overage_charges_charged_has_quantity
  CHECK (status <> 'charged' OR overage_quantity = 0 OR charged_quantity > 0);

COMMENT ON COLUMN public.subscription_overage_charges.charged_quantity IS
  'Quantity Paddle actually billed for this row. When resolving a needs_reconciliation or error row by hand, set status = ''charged'' AND charged_quantity to what the Paddle subscription shows; a status-only update is rejected by subscription_overage_charges_charged_has_quantity.';
