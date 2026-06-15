-- P3-15: keep the judge's RAW numeric answer alongside the normalised 0..1.
-- Today eval_results.value_number stores (raw - scale_min)/(scale_max - scale_min)
-- only, so "the judge said 4 out of 5" is unrecoverable from the row — you can
-- only show 0.8. Store the pre-normalisation number too so the dashboard can
-- render the original scale and downstream stats keep their full precision.
--
-- P3-16: precompute the distribution / sample summary for typed runs that have
-- no avg_score (CATEGORICAL, TEXT, and BOOLEAN where the dashboard wants the
-- raw true/false tally next to the pass-rate). Today the UI either re-fetches
-- every per-sample row to build the histogram client-side, or shows nothing.
-- A jsonb summary on eval_runs collapses that to one cheap read.
--
-- Additive + nullable (gotcha #25). value_raw_number stays NULL for pre-
-- migration rows and for non-numeric typed configs (BOOLEAN / CATEGORICAL /
-- TEXT). distribution stays NULL for NUMERIC/legacy runs where avg_score +
-- score_stddev already say everything useful.

ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS value_raw_number numeric;

ALTER TABLE eval_runs
  ADD COLUMN IF NOT EXISTS distribution jsonb;
