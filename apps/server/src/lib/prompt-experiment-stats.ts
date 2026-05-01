/**
 * Pure statistical helpers for A/B experiment evaluation.
 * No external dependencies — all pure math.
 */

export interface StatResult {
  /** z-score or t-statistic */
  statistic: number
  pValue: number
  /** p < 0.05 two-tailed */
  significant: boolean
  /** Relative lift (b - a) / |a|, null if a === 0 */
  relativeLift: number | null
}

// ── Normal distribution approximation (Abramowitz & Stegun 26.2.17) ─────────

function normalCdf(x: number): number {
  if (x < 0) return 1 - normalCdf(-x)
  const t = 1 / (1 + 0.2316419 * x)
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 +
            t * 1.330274429))))
  return 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x) * poly
}

/**
 * Approximate p-value for Student's t with `df` degrees of freedom.
 * For df ≥ 30 we just use the normal approximation — good enough for
 * the sample sizes we encounter in practice.
 */
function tPValue(t: number, df: number): number {
  if (df >= 30) return 2 * (1 - normalCdf(Math.abs(t)))
  // For small df use a simple continued-fraction approximation
  // (Numerical Recipes, section 6.4 — not exact, but adequate for UX)
  const x = df / (df + t * t)
  let sum = 1
  let term = 1
  for (let i = 1; i <= 50; i++) {
    term *= ((i - 0.5) / i) * x
    sum += term
    if (Math.abs(term) < 1e-10) break
  }
  const p = Math.sqrt(1 - x) * sum
  return Math.min(1, Math.max(0, p))
}

// ── Two-proportion z-test (error rates) ──────────────────────────────────────

/**
 * Two-proportion z-test comparing error rates of version A vs version B.
 * Minimum 30 samples per arm to avoid misleading small-sample p-values.
 */
export function errorRateTest(
  na: number,
  errA: number,
  nb: number,
  errB: number,
): StatResult {
  const insufficient = { statistic: 0, pValue: 1, significant: false, relativeLift: null }
  if (na < 30 || nb < 30) return insufficient

  const pa = errA / na
  const pb = errB / nb
  const p = (errA + errB) / (na + nb)
  const se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb))
  if (se === 0) return { ...insufficient, relativeLift: 0 }

  const z = (pa - pb) / se
  const pValue = 2 * (1 - normalCdf(Math.abs(z)))
  const relativeLift = pa === 0 ? null : (pb - pa) / pa

  return { statistic: z, pValue, significant: pValue < 0.05, relativeLift }
}

// ── Welch's t-test (latency / cost means) ────────────────────────────────────

/**
 * Welch's t-test for two independent samples with potentially unequal variances.
 * Minimum 10 samples per arm.
 *
 * `varA` / `varB` are *sample variances* (sum of squared deviations / (n-1)).
 */
export function welchTest(
  na: number,
  meanA: number,
  varA: number,
  nb: number,
  meanB: number,
  varB: number,
): StatResult {
  const insufficient = { statistic: 0, pValue: 1, significant: false, relativeLift: null }
  if (na < 10 || nb < 10) return insufficient

  const se2A = varA / na
  const se2B = varB / nb
  const se = Math.sqrt(se2A + se2B)
  if (se === 0) return { ...insufficient, relativeLift: meanA === 0 ? null : (meanB - meanA) / meanA }

  const t = (meanA - meanB) / se

  // Welch–Satterthwaite degrees of freedom
  const numerator = (se2A + se2B) ** 2
  const denominator = (se2A ** 2) / Math.max(na - 1, 1) + (se2B ** 2) / Math.max(nb - 1, 1)
  const df = denominator > 0 ? numerator / denominator : na + nb - 2

  const pValue = tPValue(t, df)
  const relativeLift = meanA === 0 ? null : (meanB - meanA) / meanA

  return { statistic: t, pValue, significant: pValue < 0.05, relativeLift }
}
