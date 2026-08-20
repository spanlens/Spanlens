// Pure formatters and score helpers shared by the evals surfaces. No React,
// no hooks — safe to import from any of the eval sections.

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`
}

export function fmtScore(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${(n * 100).toFixed(1)}`
}

// P1-7: half-width of the 95% CI for the mean (normal approx, z=1.96):
// margin = 1.96 * stddev / sqrt(n). Returned on the same 0..1 scale as the
// score; callers render it ×100 to match fmtScore. null when the run can't
// support an interval (no spread stored, or fewer than 2 scored samples).
export function ciMargin95(stddev: number | null | undefined, n: number): number | null {
  if (stddev == null || !Number.isFinite(stddev) || n < 2) return null
  return (1.96 * stddev) / Math.sqrt(n)
}

// Color tier for score 0..1 — matches the QualityBadge thresholds on the
// prompts page so the visual language is consistent across the dashboard.
// >= 0.80 good, >= 0.60 warn, otherwise bad. Null returns the muted token.
export function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'text-text-faint'
  if (score >= 0.8) return 'text-good'
  if (score >= 0.6) return 'text-warn'
  return 'text-bad'
}
