/**
 * P1-7: sample statistics for eval scores.
 *
 * `eval_runs.avg_score` is a point estimate. With a finite sample it carries
 * sampling error — a 0.82 from 8 samples and a 0.82 from 200 are not equally
 * trustworthy. We compute the sample standard deviation at run completion and
 * store it so the dashboard / SDK can render a 95% confidence interval and tell
 * whether a score difference between two prompt versions is statistically
 * meaningful (rather than noise).
 *
 * Pure + sync + dependency-free so it's trivially unit-testable.
 */

/**
 * Sample (Bessel-corrected, n-1) standard deviation of a set of scores.
 * Returns null when there are fewer than 2 values — a single point has no
 * spread, and the caller renders "interval unavailable" rather than 0.
 */
export function sampleStdDev(values: number[]): number | null {
  const n = values.length
  if (n < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1)
  return Math.sqrt(variance)
}

/**
 * Half-width of the 95% confidence interval for the mean, using the normal
 * approximation (z = 1.96): margin = 1.96 * stddev / sqrt(n). The interval is
 * `mean ± margin`.
 *
 * The normal approximation is standard for this kind of dashboard summary; for
 * very small n the Student-t critical value would be marginally wider, but we
 * deliberately avoid pulling in a t-table — the goal is "is this difference
 * real or noise", which the z-interval answers well enough. Returns null when
 * the inputs can't support an interval (no stddev, or n < 2).
 */
export function confidenceMargin95(stddev: number | null, n: number): number | null {
  if (stddev == null || !Number.isFinite(stddev) || n < 2) return null
  return (1.96 * stddev) / Math.sqrt(n)
}
