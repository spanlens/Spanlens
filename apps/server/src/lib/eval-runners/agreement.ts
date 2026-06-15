/**
 * P3-19: server-side LLM-judge ↔ human-eval agreement statistics.
 *
 * The previous flow shipped paired (judge, human) scores to the browser and
 * recomputed Pearson r on every render. That worked for NUMERIC scores but
 * couldn't say anything about CATEGORICAL ("Helpful" / "Neutral" / ...) or
 * BOOLEAN (pass/fail) evaluators — there's no meaningful Pearson on labels.
 *
 * This module adds Cohen's κ for those typed configs and centralises both
 * metrics server-side, so dashboards / SDK consumers see a uniform shape
 * regardless of the evaluator type.
 *
 * Pure, sync, dependency-free.
 */

/** A judge ↔ human pair, generic over the value type. */
export interface NumericPair {
  judge: number
  human: number
}

export interface LabelPair {
  judge: string
  human: string
}

/** Combined result for the dashboard. `value` is on each metric's own scale:
 *  Pearson r in [-1, 1], Cohen's κ in [-1, 1] (chance-adjusted agreement). */
export interface AgreementResult {
  metric: 'pearson' | 'kappa'
  value: number
  /** Sample size after filtering to complete pairs. */
  n: number
  /** Standard rule-of-thumb bucket for quick reading. */
  interpretation: 'none' | 'weak' | 'moderate' | 'strong'
}

/**
 * Pearson product-moment correlation. Returns null on degenerate input
 * (<2 pairs or zero variance on either side).
 */
export function pearsonR(pairs: NumericPair[]): number | null {
  const n = pairs.length
  if (n < 2) return null
  let sA = 0, sB = 0, sA2 = 0, sB2 = 0, sAB = 0
  for (const p of pairs) {
    sA += p.judge
    sB += p.human
    sA2 += p.judge * p.judge
    sB2 += p.human * p.human
    sAB += p.judge * p.human
  }
  const num = n * sAB - sA * sB
  const den = Math.sqrt((n * sA2 - sA * sA) * (n * sB2 - sB * sB))
  if (den === 0) return null
  return num / den
}

/**
 * Cohen's κ for nominal labels. Equivalent for 2-class (BOOLEAN) and
 * multi-class (CATEGORICAL) — κ collapses to the binary case when the label
 * universe has size 2.
 *
 *   κ = (po - pe) / (1 - pe)
 *   po = observed agreement (sum of diagonal / n)
 *   pe = chance agreement (sum_k (row_k * col_k) / n²)
 *
 * Returns null when n < 2, when the rater label sets are degenerate, or when
 * pe == 1 (no room above chance, division undefined).
 */
export function cohensKappa(pairs: LabelPair[]): number | null {
  const n = pairs.length
  if (n < 2) return null
  // Universe of labels seen on either side. Order does not affect κ.
  const labels = new Set<string>()
  for (const p of pairs) {
    labels.add(p.judge)
    labels.add(p.human)
  }
  if (labels.size < 2) {
    // Both raters used a single identical label everywhere → trivially in
    // perfect agreement, but κ is undefined (pe = 1). Convention: return null.
    return null
  }

  // Marginal frequencies and the diagonal count (observed agreement).
  const rowTotals = new Map<string, number>()
  const colTotals = new Map<string, number>()
  let agreeCount = 0
  for (const p of pairs) {
    rowTotals.set(p.judge, (rowTotals.get(p.judge) ?? 0) + 1)
    colTotals.set(p.human, (colTotals.get(p.human) ?? 0) + 1)
    if (p.judge === p.human) agreeCount++
  }

  const po = agreeCount / n
  let pe = 0
  for (const label of labels) {
    const r = rowTotals.get(label) ?? 0
    const c = colTotals.get(label) ?? 0
    pe += (r * c) / (n * n)
  }
  if (pe === 1) return null
  return (po - pe) / (1 - pe)
}

/**
 * Bucket a metric value into the standard "rule-of-thumb" interpretation.
 * Same cutoffs Pearson interpretation already used in the dashboard
 * (`|r| < 0.2 = none`, < 0.4 = weak, < 0.7 = moderate, else strong) — applied
 * to κ too since the magnitudes are comparable in [-1, 1].
 */
export function interpretAgreement(value: number): AgreementResult['interpretation'] {
  const m = Math.abs(value)
  if (m >= 0.7) return 'strong'
  if (m >= 0.4) return 'moderate'
  if (m >= 0.2) return 'weak'
  return 'none'
}

/**
 * Run-mode selector: looks at the score_config the evaluator + reviewer both
 * targeted and picks the right metric. Returns null when the metric can't be
 * computed (too few pairs, degenerate labels).
 */
export function computeAgreement(args: {
  type: 'numeric' | 'categorical' | 'boolean'
  numericPairs?: NumericPair[]
  labelPairs?: LabelPair[]
}): AgreementResult | null {
  if (args.type === 'numeric') {
    const pairs = args.numericPairs ?? []
    const r = pearsonR(pairs)
    if (r === null || !Number.isFinite(r)) return null
    return { metric: 'pearson', value: r, n: pairs.length, interpretation: interpretAgreement(r) }
  }
  // CATEGORICAL + BOOLEAN both reduce to Cohen's κ over the label pairs.
  const pairs = args.labelPairs ?? []
  const k = cohensKappa(pairs)
  if (k === null || !Number.isFinite(k)) return null
  return { metric: 'kappa', value: k, n: pairs.length, interpretation: interpretAgreement(k) }
}
