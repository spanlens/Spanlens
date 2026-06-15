-- P1-7: store the sample standard deviation of an eval run's scores so the
-- dashboard / SDK can render a 95% confidence interval on avg_score.
--
-- avg_score is a point estimate. A 0.82 from 8 samples and a 0.82 from 200
-- samples are not equally trustworthy, and "version B scored 0.84 vs A's 0.81"
-- might be noise. Storing the spread lets us show `avg ± margin (95% CI)` and
-- tell whether a score difference between two prompt versions is meaningful.
--
-- The runner writes this for NUMERIC and BOOLEAN (pass-rate) runs — the two
-- types whose avg_score is a mean. CATEGORICAL / TEXT leave it NULL (no mean).
-- Additive + nullable so existing rows stay valid and old dashboard queries are
-- unaffected (gotcha #25). Pre-existing rows keep NULL = "interval unavailable".

ALTER TABLE eval_runs
  ADD COLUMN IF NOT EXISTS score_stddev numeric;
