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
import { randomUUID } from 'node:crypto'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
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
import { writeTraceAsEvent, writeSpanAsEvent } from '../lib/events-writer.js'
import { ApiError } from '../lib/errors.js'

export const otlpRouter = new Hono<ApiKeyContext>()

// ── POST /v1/traces ────────────────────────────────────────────────────────────

otlpRouter.post('/v1/traces', authApiKey, requireFullScope, async (c) => {
  const organizationId = c.get('organizationId')
  // Narrowing: requireFullScope (mounted on this route) + DB CHECK constraint
  // guarantee non-null here.
  const projectId      = c.get('projectId') as string
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
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
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
      //
      // R-12 Phase 3.2b: pre-assign a Postgres UUID per span so the same
      // id can be threaded through to events.event_id. ClickHouse demands
      // UUID for event_id / parent_event_id — we can't use the raw OTLP
      // hex span_id there. The Postgres `spans.id` column has
      // `DEFAULT gen_random_uuid()`, so supplying an explicit id is a
      // no-op for existing behaviour. The in-batch hex→UUID map below
      // also lets parent_event_id link spans whose parent arrived in the
      // same OTLP export; cross-batch parents stay null in events (the
      // existing orphan-span-link background migration only touches the
      // Postgres side).
      type SpanRowWithId = MappedSpanRow & { id: string }
      const hexToUuid = new Map<string, string>()
      const spanRows: SpanRowWithId[] = spans.map((s) => {
        const row = mapOtlpSpan(s, traceUuid, organizationId) as SpanRowWithId
        row.id = randomUUID()
        if (row.external_span_id) hexToUuid.set(row.external_span_id, row.id)
        return row
      })

      // Track which spans actually landed in Postgres so we don't
      // dual-write events for rows the bulk + per-row INSERT both
      // rejected. Keeps the two read paths consistent (rejected on
      // legacy → also missing on events).
      const insertedIds = new Set<string>(spanRows.map((r) => r.id))

      // ── 4. Bulk insert spans ───────────────────────────────────────
      const { error: bulkErr } = await supabaseAdmin.from('spans').insert(spanRows)

      if (bulkErr) {
        // Bulk insert failed (e.g., a single bad row poisoned the batch).
        // Fall back to per-row inserts so we can count precise failures.
        console.warn('[otlp] bulk span insert failed, retrying individually:', bulkErr.message)
        insertedIds.clear()
        for (const row of spanRows) {
          const { error: singleErr } = await supabaseAdmin.from('spans').insert(row)
          if (singleErr) {
            console.error('[otlp] single span insert failed:', singleErr.message)
            rejectedSpans++
          } else {
            insertedIds.add(row.id)
          }
        }
      }

      // ── 5. Events dual-write (R-12 Phase 3.2b) ─────────────────────
      // Without this, orgs flipped to read_from_events lose every OTLP
      // trace and its spans — the Postgres rows land but events stays
      // empty. The SDK ingest path (api/ingest.ts) added this in PR #310;
      // OTLP was the remaining gap that left the dogfood org with a
      // 127-vs-113 trace-count drift between the two read paths.
      //
      // Best-effort: failures here log loudly but never reject the OTLP
      // export — the source-of-truth Postgres rows already landed and
      // the legacy read path keeps working. The events-writer queues
      // failed inserts to `events_fallback` (logger.ts pattern) so the
      // `/cron/replay-fallback` cron drains them when CH recovers.
      try {
        await writeTraceAsEvent({
          traceId:        traceUuid,
          organizationId,
          projectId,
          apiKeyId,
          name:           traceName,
          startedAt,
          endedAt:        endedAt ?? null,
          status:         traceStatus,
          errorMessage:   hasError ? 'One or more spans reported errors' : null,
          durationMs:     durationMs,
        })
      } catch (err) {
        console.error('[otlp] trace events shadow INSERT failed:', err instanceof Error ? err.message : err)
      }

      // Map each successfully-inserted span to an event_type='span' row.
      // We rely on the Postgres bulk INSERT having succeeded; spans the
      // per-row fallback rejected stay out of events too (consistent
      // with the Postgres read path).
      //
      // OTLP spans don't carry usage on every row — only LLM-kind spans
      // (gen_ai.usage.*) have prompt/completion tokens. We just thread
      // whatever the mapper produced; events-writer's default-zero
      // behaviour keeps non-LLM spans well-formed.
      for (const row of spanRows) {
        if (!insertedIds.has(row.id)) continue
        // parent_event_id MUST be a UUID. If the parent landed in the
        // same OTLP batch we already know its assigned UUID; otherwise
        // (cross-batch parent) leave null and let a future events-side
        // orphan-link migration backfill it.
        const parentEventId =
          row.external_parent_span_id != null
            ? (hexToUuid.get(row.external_parent_span_id) ?? null)
            : null
        try {
          await writeSpanAsEvent({
            spanId:         row.id,
            traceId:        traceUuid,
            parentSpanId:   parentEventId,
            organizationId,
            projectId,
            apiKeyId,
            name:           row.name,
            spanType:       row.span_type,
            startedAt:      row.started_at,
            endedAt:        row.ended_at,
            durationMs:     row.duration_ms,
            status:         row.status,
            errorMessage:   row.error_message,
            input:          row.input,
            output:         row.output,
            metadata:       row.metadata,
            promptTokens:   row.prompt_tokens,
            completionTokens: row.completion_tokens,
            totalTokens:    row.total_tokens,
            costUsd:        row.cost_usd,
          })
        } catch (err) {
          console.error('[otlp] span events shadow INSERT failed:', err instanceof Error ? err.message : err)
        }
      }

      // ── 6. Parent linkage runs asynchronously (R-14, Sprint 5) ─────
      // The synchronous link_otlp_span_parents() RPC used to run here
      // turned each OTLP batch into N+1 round-trips on the spans table.
      // It now lives in the `orphan-span-link` background migration
      // (registry/migrations/orphan-span-link.ts) which scans rows
      // matching the spans_orphan_external_parent_idx in chunks. The
      // RPC itself is still in the DB for one-shot reconciliation but
      // no request path calls it. Children whose parent arrived in a
      // later batch are visible immediately (rendered with a null
      // parent until the background job runs, typically within minutes).
      // The /cron/detect-orphan-spans cron alerts if the orphan count
      // exceeds threshold so a stuck job is noticed quickly.
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
