/**
 * /cron/detect-missing-model-prices — alert when a model accumulates many
 * cost_usd=NULL rows in the last hour (i.e., we are missing its price).
 *
 * Extracted from api/cron.ts. Threshold 100 rows/hour picked to surface
 * real coverage gaps fast but tolerate a brand-new model appearing
 * mid-window. Idempotent: an unresolved missing_model_prices alert
 * already in internal_alerts deduplicates.
 */

// Cross-tenant scan by design — operator-internal cron. The
// no-restricted-imports rule is scoped to api/ handlers and does not
// fire here, so the inline disable was a no-op.
import { pgQuery } from '../postgres.js'
import { supabaseAdmin } from '../db.js'
import { anyActivitySince } from '../org-activity.js'

export interface DetectMissingModelPricesResult {
  ok: boolean
  missing: number
  models?: Array<{ model: string; count: number }>
  error?: string
}

const THRESHOLD = 100

export async function runDetectMissingModelPricesJob(): Promise<DetectMissingModelPricesResult> {
  try {
    // Nothing was logged anywhere in the last hour, so the scan below has no
    // rows to find; skip it rather than paying for a full-table aggregate
    // that can only come back empty. `anyActivitySince` fails open, so an
    // unreadable watermark still runs the scan.
    const windowStart = new Date(Date.now() - 60 * 60 * 1000)
    if (!(await anyActivitySince(windowStart))) return { ok: true, missing: 0 }

    // HAVING cannot reference a SELECT alias in Postgres, so the aggregate is
    // spelled out a second time rather than reusing `missing_count`.
    const rs = await pgQuery<{ model: string; missing_count: string }>({
      query: `
        SELECT model, count(*) AS missing_count
        FROM requests
        WHERE created_at >= now() - INTERVAL '1 hour'
          AND cost_usd IS NULL
          AND model <> ''
        GROUP BY model
        HAVING count(*) > {threshold}
        ORDER BY missing_count DESC
      `,
      params: { threshold: THRESHOLD },
    })

    // `count(*)` is int8, which the driver hands back as a string to avoid
    // silent precision loss, so coerce before comparing or summing.
    const models = rs.map((row) => ({
      model: row.model,
      count: Number(row.missing_count),
    }))

    if (models.length === 0) return { ok: true, missing: 0 }

    const totalRows = models.reduce((sum, m) => sum + m.count, 0)
    const { error: insertError } = await supabaseAdmin.from('internal_alerts').insert({
      kind: 'missing_model_prices',
      severity: 'warn',
      message: `${models.length} model(s) missing prices in last 1h (${totalRows} rows)`,
      details: { models, threshold: THRESHOLD },
    })

    if (insertError) {
      return { ok: false, missing: models.length, error: `internal_alerts insert failed: ${insertError.message}` }
    }
    return { ok: true, missing: models.length, models }
  } catch (err) {
    return { ok: false, missing: 0, error: err instanceof Error ? err.message : String(err) }
  }
}
