-- P0-2: make partial scoring visible on eval_runs.
--
-- Today eval_runs stores only scored_count. The judge path silently drops
-- any sample whose judge call fails (429 / 5xx / timeout / parse error) and
-- still marks the run 'completed'. So a run that scored 5 of 50 samples
-- looks identical to one that scored all 50 — the operator trusts a
-- 5-sample average as if it were 50.
--
-- Add two counters so the run can report "attempted N / scored M / failed K":
--   attempted_count — samples we tried to score (after empty-response filter)
--   failed_count    — samples whose scoring failed (attempted - scored)
--
-- Additive + NOT NULL DEFAULT 0 so existing rows backfill automatically and
-- old dashboard queries are unaffected (gotcha #25). The runner is updated in
-- the same PR to populate both; pre-existing rows keep 0/0 (unknown), which
-- the dashboard renders as "rate unavailable" rather than a misleading 100%.

ALTER TABLE eval_runs
  ADD COLUMN IF NOT EXISTS attempted_count integer NOT NULL DEFAULT 0;

ALTER TABLE eval_runs
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0;
