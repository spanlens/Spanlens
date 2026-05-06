/**
 * OTLP/HTTP JSON receiver — POST /v1/traces
 *
 * Accepts OTel SDK exports using the gen_ai.* semantic conventions and
 * persists them into Spanlens traces + spans tables.
 *
 * Auth: Spanlens API key (sl_live_*) via Authorization: Bearer or x-api-key header.
 * Content-Type: application/json (Protobuf not supported).
 *
 * Response format (OTLP spec):
 *   200 {}                                         — all spans accepted
 *   200 {"partialSuccess":{"rejectedSpans":N}}     — some spans rejected
 *   400 {"error":"..."}                            — invalid request
 *   415 {"error":"..."}                            — unsupported media type
 *
 * Ref: https://opentelemetry.io/docs/specs/otlp/
 *      https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
 */

import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { supabaseAdmin } from '../lib/db.js'
import {
  groupByTrace,
  inferTraceName,
  minStartTime,
  maxEndTime,
  mapOtlpSpan,
  type OtlpExportRequest,
  type MappedSpanRow,
} from '../lib/otlp-mapper.js'

export const otlpRouter = new Hono<ApiKeyContext>()

// ── POST /v1/traces ────────────────────────────────────────────────────────────

otlpRouter.post('/v1/traces', authApiKey, async (c) => {
  const organizationId = c.get('organizationId')
  const projectId      = c.get('projectId')
  const apiKeyId       = c.get('apiKeyId')

  // Protobuf not supported — tell the client to use JSON
  const contentType = c.req.header('Content-Type') ?? ''
  if (contentType.includes('application/x-protobuf')) {
    return c.json(
      { error: 'Protobuf OTLP encoding is not supported. Use Content-Type: application/json.' },
      415,
    )
  }

  let body: OtlpExportRequest
  try {
    body = (await c.req.json()) as OtlpExportRequest
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const groups = groupByTrace(body)
  if (groups.size === 0) {
    // Nothing to ingest — valid but empty payload
    return c.json({})
  }

  let rejectedSpans = 0

  for (const [externalTraceId, spans] of groups) {
    try {
      // ── 1. Infer trace-level metadata ──────────────────────────────
      const traceName  = inferTraceName(spans)
      const startedAt  = minStartTime(spans)
      const endedAt    = maxEndTime(spans)
      const durationMs = endedAt
        ? Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime())
        : null

      // Pre-map spans so we can derive trace status before upserting the trace.
      // trace_id is filled in after the upsert; we use '' as placeholder.
      const preMapped: MappedSpanRow[] = spans.map((s) =>
        mapOtlpSpan(s, '', organizationId),
      )
      const hasError   = preMapped.some((r) => r.status === 'error')
      const traceStatus = hasError ? 'error' : 'completed'

      // ── 2. Upsert trace row ────────────────────────────────────────
      // Conflict target: (organization_id, external_trace_id) unique index.
      // span_count / total_tokens / total_cost_usd are maintained by the
      // spans_refresh_trace_aggregates DB trigger — don't override them here.
      const tracePayload: Record<string, unknown> = {
        organization_id:   organizationId,
        project_id:        projectId,
        api_key_id:        apiKeyId,
        external_trace_id: externalTraceId,
        name:              traceName,
        status:            traceStatus,
        started_at:        startedAt,
        ended_at:          endedAt,
        duration_ms:       durationMs,
      }
      if (hasError) {
        tracePayload['error_message'] = 'One or more spans reported errors'
      }

      const { data: traceRow, error: traceErr } = await supabaseAdmin
        .from('traces')
        .upsert(tracePayload, { onConflict: 'organization_id,external_trace_id' })
        .select('id')
        .single()

      if (traceErr || !traceRow) {
        console.error('[otlp] trace upsert failed:', traceErr?.message)
        rejectedSpans += spans.length
        continue
      }

      const traceUuid = traceRow.id as string

      // ── 3. Build final span rows with the real trace UUID ──────────
      const spanRows: MappedSpanRow[] = spans.map((s) =>
        mapOtlpSpan(s, traceUuid, organizationId),
      )

      // ── 4. Bulk insert spans ───────────────────────────────────────
      const { error: bulkErr } = await supabaseAdmin.from('spans').insert(spanRows)

      if (bulkErr) {
        // Bulk insert failed (e.g., a single bad row poisoned the batch).
        // Fall back to per-row inserts so we can count precise failures.
        console.warn('[otlp] bulk span insert failed, retrying individually:', bulkErr.message)
        for (const row of spanRows) {
          const { error: singleErr } = await supabaseAdmin.from('spans').insert(row)
          if (singleErr) {
            console.error('[otlp] single span insert failed:', singleErr.message)
            rejectedSpans++
          }
        }
      }

      // ── 5. Resolve external parent → UUID parent links ─────────────
      // link_otlp_span_parents() updates child.parent_span_id = parent.id
      // by matching child.external_parent_span_id = parent.external_span_id
      // within this trace. Only updates rows where parent_span_id IS NULL
      // so the call is idempotent.
      const { error: linkErr } = await supabaseAdmin.rpc('link_otlp_span_parents', {
        p_trace_id: traceUuid,
      })
      if (linkErr) {
        // Non-fatal: spans are still visible; just parent linkage is missing.
        console.error('[otlp] link_otlp_span_parents failed:', linkErr.message)
      }
    } catch (err) {
      console.error('[otlp] unexpected error processing trace group:', externalTraceId, err)
      rejectedSpans += spans.length
    }
  }

  // OTLP spec: partial success when at least one span was rejected
  if (rejectedSpans > 0) {
    return c.json({ partialSuccess: { rejectedSpans } })
  }
  return c.json({})
})
