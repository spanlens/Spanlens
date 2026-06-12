/**
 * /cron/detect-orphan-spans — R-14 watchdog over the `orphan-span-link`
 * background migration. Counts spans where the parent never arrived
 * (`external_parent_span_id IS NOT NULL` and `parent_span_id IS NULL`)
 * older than 1h, alerts when count exceeds threshold.
 *
 * Extracted from api/cron.ts. Threshold 100 picked low enough that real
 * backlog surfaces fast but high enough that one slow OTLP batch doesn't
 * page. Dedup against unresolved alerts of the same kind.
 */

import { supabaseAdmin } from '../db.js'

export interface DetectOrphanSpansResult {
  ok: boolean
  count: number
  threshold: number
  alerted: boolean
  deduped?: boolean
  existing_alert_id?: string
  error?: string
}

const THRESHOLD = 100

export async function runDetectOrphanSpansJob(): Promise<DetectOrphanSpansResult> {
  const olderThan = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  try {
    const { count, error: countError } = await supabaseAdmin
      .from('spans')
      .select('id', { count: 'exact', head: true })
      .is('parent_span_id', null)
      .not('external_parent_span_id', 'is', null)
      .lt('created_at', olderThan)

    if (countError) {
      return { ok: false, count: 0, threshold: THRESHOLD, alerted: false, error: countError.message }
    }

    const orphanCount = count ?? 0

    if (orphanCount <= THRESHOLD) {
      return { ok: true, count: orphanCount, threshold: THRESHOLD, alerted: false }
    }

    const { data: existing } = await supabaseAdmin
      .from('internal_alerts')
      .select('id')
      .eq('kind', 'orphan_spans')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle()

    if (existing) {
      return {
        ok: true, count: orphanCount, threshold: THRESHOLD, alerted: false,
        deduped: true, existing_alert_id: existing.id,
      }
    }

    const { error: insertError } = await supabaseAdmin.from('internal_alerts').insert({
      kind: 'orphan_spans',
      severity: 'warn',
      message: `${orphanCount} orphan spans > 1h old (threshold ${THRESHOLD})`,
      details: { count: orphanCount, threshold: THRESHOLD, older_than: olderThan },
    })

    if (insertError) {
      return { ok: false, count: orphanCount, threshold: THRESHOLD, alerted: false, error: `internal_alerts insert failed: ${insertError.message}` }
    }

    return { ok: true, count: orphanCount, threshold: THRESHOLD, alerted: true }
  } catch (err) {
    return { ok: false, count: 0, threshold: THRESHOLD, alerted: false, error: err instanceof Error ? err.message : String(err) }
  }
}
