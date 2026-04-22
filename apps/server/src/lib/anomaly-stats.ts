/**
 * Pure statistical helpers for anomaly detection. No DB or network access,
 * so these can be imported from tests without tripping Supabase env checks.
 */

export interface Stats {
  mean: number
  stdDev: number
  count: number
}

export function computeStats(values: readonly number[]): Stats {
  const n = values.length
  if (n === 0) return { mean: 0, stdDev: 0, count: 0 }
  const mean = values.reduce((s, v) => s + v, 0) / n
  if (n < 2) return { mean, stdDev: 0, count: n }
  const sumSquaredDiff = values.reduce((s, v) => s + (v - mean) ** 2, 0)
  const stdDev = Math.sqrt(sumSquaredDiff / (n - 1)) // sample stddev (n-1)
  return { mean, stdDev, count: n }
}

export interface Bucketable {
  provider: string
  model: string
}

export function groupByBucket<T extends Bucketable>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const key = `${r.provider}|${r.model}`
    const bucket = out.get(key) ?? []
    bucket.push(r)
    out.set(key, bucket)
  }
  return out
}
