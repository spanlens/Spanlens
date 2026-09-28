-- ─────────────────────────────────────────────────────────────────────────────
-- subscription_overage_charges: provisional charge + post-period true-up.
--
-- WHY (quality audit 2026-09-28, C4.3):
--   The daily cron charges a period's overage inside the 48 hours before
--   period_end, and UNIQUE (subscription_id, period_end) allowed exactly one
--   row per period. The charge therefore counted usage up to the run, never
--   the last 24-48 hours of the period, and nothing billed that tail later:
--   a systematic 3-7% of every period's overage went unbilled. The 'retry'
--   status the original migration documents had no code behind it, and the
--   finalize UPDATE's { error } was ignored.
--
-- WHAT:
--   * kind: 'provisional' (in-window charge, as before) or 'true_up' (after
--     the period closes: recount the final usage and charge only the
--     difference to what was already charged). UNIQUE (subscription_id,
--     period_end, kind) replaces UNIQUE (subscription_id, period_end), so
--     each kind is still charged at most once per period.
--   * charged_quantity: what Paddle actually billed for the row. The true-up
--     charges final_quantity - sum(charged_quantity) and never runs while a
--     row of that period is in an unresolved state.
--   * included_requests: the quota the period was measured against, so the
--     true-up does not depend on the plan the subscription has by then.
--   * status adds:
--       no_charge            — nothing was owed (still recorded, so the
--                              true-up knows the period was looked at)
--       needs_reconciliation — the charge outcome is unknown (network error,
--                              timeout, 5xx, or the ledger update failed after
--                              Paddle answered). Never retried automatically:
--                              check the subscription in Paddle, then set
--                              status to 'charged' with the billed
--                              charged_quantity, or to 'retry'.
--       retry                — operator instruction: the cron re-attempts the
--                              row's remaining quantity (quantity minus
--                              charged_quantity), then settles as usual.
--   Existing rows become kind 'provisional'; charged rows get
--   charged_quantity = overage_quantity.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.subscription_overage_charges
  ADD COLUMN IF NOT EXISTS kind              TEXT NOT NULL DEFAULT 'provisional',
  ADD COLUMN IF NOT EXISTS charged_quantity  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS included_requests INTEGER;

UPDATE public.subscription_overage_charges
   SET charged_quantity = overage_quantity
 WHERE status = 'charged' AND charged_quantity = 0;

ALTER TABLE public.subscription_overage_charges
  DROP CONSTRAINT IF EXISTS subscription_overage_charges_kind_check;
ALTER TABLE public.subscription_overage_charges
  ADD CONSTRAINT subscription_overage_charges_kind_check
  CHECK (kind IN ('provisional', 'true_up'));

ALTER TABLE public.subscription_overage_charges
  DROP CONSTRAINT IF EXISTS subscription_overage_charges_charged_quantity_check;
ALTER TABLE public.subscription_overage_charges
  ADD CONSTRAINT subscription_overage_charges_charged_quantity_check
  CHECK (charged_quantity >= 0);

ALTER TABLE public.subscription_overage_charges
  DROP CONSTRAINT IF EXISTS subscription_overage_charges_status_check;
ALTER TABLE public.subscription_overage_charges
  ADD CONSTRAINT subscription_overage_charges_status_check
  CHECK (status IN ('pending', 'charged', 'error', 'retry', 'no_charge', 'needs_reconciliation'));

-- New key first, then drop the old one, so no moment is left unguarded.
ALTER TABLE public.subscription_overage_charges
  DROP CONSTRAINT IF EXISTS subscription_overage_charges_period_kind_key;
ALTER TABLE public.subscription_overage_charges
  ADD CONSTRAINT subscription_overage_charges_period_kind_key
  UNIQUE (subscription_id, period_end, kind);
ALTER TABLE public.subscription_overage_charges
  DROP CONSTRAINT IF EXISTS subscription_overage_charges_subscription_id_period_end_key;

-- Rows an operator or the cron has to act on.
DROP INDEX IF EXISTS public.subscription_overage_charges_status_idx;
CREATE INDEX IF NOT EXISTS subscription_overage_charges_open_status_idx
  ON public.subscription_overage_charges (status)
  WHERE status IN ('pending', 'error', 'retry', 'needs_reconciliation');

-- The settlement pass scans recently closed periods.
CREATE INDEX IF NOT EXISTS subscription_overage_charges_period_end_idx
  ON public.subscription_overage_charges (period_end);

COMMENT ON TABLE public.subscription_overage_charges IS
  'Overage charge ledger. One provisional row (in the 48h before period_end) and one true_up row (after the period closes) per subscription period, UNIQUE (subscription_id, period_end, kind). charged_quantity is what Paddle billed; needs_reconciliation rows are never retried automatically.';
