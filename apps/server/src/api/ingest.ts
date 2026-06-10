import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
import { supabaseAdmin } from '../lib/db.js'
import { fireAndForget } from '../lib/wait-until.js'
import { emitWebhookEvent } from '../lib/webhook-emit.js'
import { ApiError } from '../lib/errors.js'

/**
 * SDK용 ingestion 라우터 — authApiKey 미들웨어로 SHA-256 해시 API 키 검증.
 * 대시보드의 조회 API(`/api/v1/traces`)와 분리 (이쪽은 authJwt).
 *
 * Endpoints:
 *   POST   /ingest/traces               — 새 trace 생성
 *   PATCH  /ingest/traces/:id           — trace 종료/업데이트 (status, duration, error)
 *   POST   /ingest/traces/:id/spans     — 새 span 생성
 *   PATCH  /ingest/spans/:id            — span 종료/업데이트
 *
 * SDK가 idempotent하게 동작하도록 클라이언트가 생성한 UUID를 허용합니다
 * (body.id 있으면 그걸로 INSERT, 없으면 DB 기본값).
 */

export const ingestRouter = new Hono<ApiKeyContext>()

ingestRouter.use('*', authApiKey)
ingestRouter.use('*', requireFullScope)

type TraceStatus = 'running' | 'completed' | 'error'
type SpanStatus = 'running' | 'completed' | 'error'
type SpanType = 'llm' | 'tool' | 'retrieval' | 'embedding' | 'custom'

const VALID_TRACE_STATUS: Set<TraceStatus> = new Set(['running', 'completed', 'error'])
const VALID_SPAN_STATUS: Set<SpanStatus> = new Set(['running', 'completed', 'error'])
const VALID_SPAN_TYPE: Set<SpanType> = new Set(['llm', 'tool', 'retrieval', 'embedding', 'custom'])

function computeDurationMs(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  if (isNaN(start) || isNaN(end) || end < start) return null
  return end - start
}

import { writeTraceAsEvent, writeSpanAsEvent } from '../lib/events-writer.js'

// ── POST /ingest/traces ──────────────────────────────────────
ingestRouter.post('/traces', async (c) => {
  const organizationId = c.get('organizationId')
  // Narrowing: requireFullScope + DB CHECK constraint guarantee non-null
  // here (public-scope keys can't reach ingest endpoints).
  const projectId = c.get('projectId') as string
  const apiKeyId = c.get('apiKeyId')

  let body: {
    id?: unknown
    name?: unknown
    started_at?: unknown
    metadata?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'name is required')
  }

  const insert: {
    organization_id: string
    project_id: string
    api_key_id: string
    name: string
    id?: string
    started_at?: string
    metadata?: Record<string, unknown>
  } = {
    organization_id: organizationId,
    project_id: projectId,
    api_key_id: apiKeyId,
    name: body.name.trim(),
  }
  if (typeof body.id === 'string') insert.id = body.id
  if (typeof body.started_at === 'string') insert.started_at = body.started_at
  if (body.metadata && typeof body.metadata === 'object') {
    insert.metadata = body.metadata as Record<string, unknown>
  }

  const { data, error } = await supabaseAdmin
    .from('traces')
    .insert(insert)
    .select('id, started_at')
    .single()

  if (error || !data) {
    throw new ApiError('INTERNAL_ERROR', 'Failed to create trace', { detail: error?.message })
  }

  // Phase 5.1 dual-write to events. Best-effort — events is the shadow
  // store; reads still come from Postgres traces. Awaited rather than
  // fire-and-forget: an unawaited promise on Vercel Node runtime is
  // dropped at response time (CLAUDE.md gotcha #8). ~30ms CH round trip.
  try {
    await writeTraceAsEvent({
      traceId: data.id as string,
      organizationId,
      projectId,
      apiKeyId,
      name: insert.name,
      startedAt: (data.started_at as string) ?? new Date().toISOString(),
      metadata: insert.metadata ?? null,
    })
  } catch (err) {
    console.error('[ingest] trace events shadow INSERT failed:', err instanceof Error ? err.message : err)
  }

  return c.json({ success: true, data }, 201)
})

// ── PATCH /ingest/traces/:id ─────────────────────────────────
ingestRouter.patch('/traces/:id', async (c) => {
  const traceId = c.req.param('id')
  const organizationId = c.get('organizationId')

  let body: {
    status?: unknown
    ended_at?: unknown
    error_message?: unknown
    metadata?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const updates: Record<string, unknown> = {}
  // Status is enum-constrained: reject unknown values with 400 instead of
  // silently dropping. The silent-drop behavior produced inconsistent rows
  // (ended_at filled, status still 'running') that the dashboard rendered as
  // LIVE forever. Verified against the JS and Python SDKs — both only emit
  // 'completed' | 'error', so this is safe to harden.
  if (body.status !== undefined) {
    if (
      typeof body.status !== 'string' ||
      !VALID_TRACE_STATUS.has(body.status as TraceStatus)
    ) {
      return c.json(
        {
          error: `Invalid status. Expected one of: ${Array.from(VALID_TRACE_STATUS).join(', ')}.`,
        },
        400,
      )
    }
    updates['status'] = body.status
  }
  if (typeof body.ended_at === 'string') {
    updates['ended_at'] = body.ended_at
  }
  if (typeof body.error_message === 'string') {
    updates['error_message'] = body.error_message
  }
  if (body.metadata && typeof body.metadata === 'object') {
    updates['metadata'] = body.metadata
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError('BAD_REQUEST', 'No valid fields to update')
  }

  // duration_ms 자동 계산 — ended_at이 오고 현재 started_at만 있다면
  if (updates['ended_at']) {
    const { data: existing } = await supabaseAdmin
      .from('traces')
      .select('started_at')
      .eq('id', traceId)
      .eq('organization_id', organizationId)
      .single()
    if (existing?.started_at) {
      const duration = computeDurationMs(existing.started_at, updates['ended_at'] as string)
      if (duration !== null) updates['duration_ms'] = duration
    }
  }

  // Select the full trace state, not just the patched fields — the events
  // dual-write below appends a complete snapshot row (the events store is
  // append-only; readers keep the latest row per id, so a partial snapshot
  // would erase fields the create event carried).
  const { data, error } = await supabaseAdmin
    .from('traces')
    .update(updates)
    .eq('id', traceId)
    .eq('organization_id', organizationId)
    .select(
      'id, project_id, api_key_id, name, status, started_at, ended_at, duration_ms, error_message, metadata',
    )
    .single()

  if (error || !data) {
    throw new ApiError('NOT_FOUND', 'Trace not found or access denied')
  }

  // R-12 Phase 3.2 — dual-write the lifecycle update to events. Without
  // this the events read path (organizations.read_from_events) shows every
  // trace frozen in its create-time state: status 'running' forever,
  // ended_at/duration_ms never filled. Same awaited best-effort contract
  // as the POST path above (gotcha #8).
  try {
    await writeTraceAsEvent({
      traceId: data.id,
      organizationId,
      projectId: data.project_id,
      apiKeyId: data.api_key_id ?? null,
      name: data.name,
      startedAt: data.started_at,
      endedAt: data.ended_at ?? null,
      status: data.status ?? null,
      errorMessage: data.error_message ?? null,
      metadata: (data.metadata as Record<string, unknown> | null) ?? null,
      durationMs: data.duration_ms ?? null,
      eventTime: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[ingest] trace update events shadow INSERT failed:', err instanceof Error ? err.message : err)
  }

  // Outbound webhook: trace.completed. fireAndForget so the SDK's PATCH
  // response isn't blocked on customer-endpoint latency, and the promise is
  // drained on Vercel (gotcha #8). Best-effort — no-op for orgs without a
  // subscribed webhook.
  if (data.status === 'completed') {
    fireAndForget(
      c,
      emitWebhookEvent(organizationId, 'trace.completed', {
        trace: {
          id: data.id,
          status: data.status,
          ended_at: data.ended_at,
          duration_ms: data.duration_ms,
        },
      }),
    )
  }

  return c.json({ success: true, data })
})

// ── POST /ingest/traces/:id/spans ────────────────────────────
ingestRouter.post('/traces/:id/spans', async (c) => {
  const traceId = c.req.param('id')
  const organizationId = c.get('organizationId')

  let body: {
    id?: unknown
    parent_span_id?: unknown
    name?: unknown
    span_type?: unknown
    started_at?: unknown
    input?: unknown
    metadata?: unknown
    request_id?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'name is required')
  }

  // trace 소유권 확인 — 다른 org의 trace에 span 추가 시도 차단.
  // project_id도 함께 가져옴: spans 테이블에는 project_id 컬럼이 없어서
  // events dual-write의 project_id(UUID NOT NULL)는 부모 trace에서 와야 함.
  const { data: trace } = await supabaseAdmin
    .from('traces')
    .select('id, project_id')
    .eq('id', traceId)
    .eq('organization_id', organizationId)
    .single()
  if (!trace) throw new ApiError('NOT_FOUND', 'Trace not found')

  const insert: {
    trace_id: string
    organization_id: string
    name: string
    id?: string
    parent_span_id?: string
    span_type?: string
    started_at?: string
    input?: unknown
    metadata?: Record<string, unknown>
    request_id?: string
  } = {
    trace_id: traceId,
    organization_id: organizationId,
    name: body.name.trim(),
  }
  if (typeof body.id === 'string') insert.id = body.id
  if (typeof body.parent_span_id === 'string') insert.parent_span_id = body.parent_span_id
  if (typeof body.span_type === 'string' && VALID_SPAN_TYPE.has(body.span_type as SpanType)) {
    insert.span_type = body.span_type
  }
  if (typeof body.started_at === 'string') insert.started_at = body.started_at
  if (body.input !== undefined) insert.input = body.input
  if (body.metadata && typeof body.metadata === 'object') {
    insert.metadata = body.metadata as Record<string, unknown>
  }
  if (typeof body.request_id === 'string') insert.request_id = body.request_id

  const { data, error } = await supabaseAdmin
    .from('spans')
    .insert(insert)
    .select('id, started_at')
    .single()

  if (error || !data) {
    throw new ApiError('INTERNAL_ERROR', 'Failed to create span', { detail: error?.message })
  }

  // Phase 5.1 dual-write to events — awaited for the same reason as the
  // trace path above (CLAUDE.md gotcha #8).
  try {
    await writeSpanAsEvent({
      spanId: data.id as string,
      traceId,
      parentSpanId: insert.parent_span_id ?? null,
      organizationId,
      // R-12 Phase 3.2 fix: this used to read `insert.project_id`, which
      // NEVER exists (spans carry no project_id) — every span event was
      // written with projectId '' and rejected by ClickHouse's UUID
      // column, silently losing the whole span events stream.
      projectId: trace.project_id,
      apiKeyId: null,
      name: insert.name,
      spanType: insert.span_type ?? null,
      startedAt: (data.started_at as string) ?? new Date().toISOString(),
      input: insert.input,
      metadata: insert.metadata ?? null,
    })
  } catch (err) {
    console.error('[ingest] span events shadow INSERT failed:', err instanceof Error ? err.message : err)
  }

  return c.json({ success: true, data }, 201)
})

// ── PATCH /ingest/spans/:id ──────────────────────────────────
ingestRouter.patch('/spans/:id', async (c) => {
  const spanId = c.req.param('id')
  const organizationId = c.get('organizationId')

  let body: {
    status?: unknown
    ended_at?: unknown
    output?: unknown
    error_message?: unknown
    metadata?: unknown
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
    cost_usd?: unknown
    request_id?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const updates: Record<string, unknown> = {}
  // Match the trace PATCH handler — reject unknown status with 400 rather
  // than dropping silently. Otherwise a span ends up with ended_at filled
  // but status stuck on 'running', which the topology view renders with
  // the pulsing accent badge and a misleading "still running" hint.
  if (body.status !== undefined) {
    if (
      typeof body.status !== 'string' ||
      !VALID_SPAN_STATUS.has(body.status as SpanStatus)
    ) {
      return c.json(
        {
          error: `Invalid status. Expected one of: ${Array.from(VALID_SPAN_STATUS).join(', ')}.`,
        },
        400,
      )
    }
    updates['status'] = body.status
  }
  if (typeof body.ended_at === 'string') {
    updates['ended_at'] = body.ended_at
  }
  if (body.output !== undefined) {
    updates['output'] = body.output
  }
  if (typeof body.error_message === 'string') {
    updates['error_message'] = body.error_message
  }
  if (body.metadata && typeof body.metadata === 'object') {
    updates['metadata'] = body.metadata
  }
  if (typeof body.prompt_tokens === 'number') updates['prompt_tokens'] = body.prompt_tokens
  if (typeof body.completion_tokens === 'number') updates['completion_tokens'] = body.completion_tokens
  if (typeof body.total_tokens === 'number') updates['total_tokens'] = body.total_tokens
  if (typeof body.cost_usd === 'number') updates['cost_usd'] = body.cost_usd
  if (typeof body.request_id === 'string') updates['request_id'] = body.request_id

  if (Object.keys(updates).length === 0) {
    throw new ApiError('BAD_REQUEST', 'No valid fields to update')
  }

  if (updates['ended_at']) {
    const { data: existing } = await supabaseAdmin
      .from('spans')
      .select('started_at')
      .eq('id', spanId)
      .eq('organization_id', organizationId)
      .single()
    if (existing?.started_at) {
      const duration = computeDurationMs(existing.started_at, updates['ended_at'] as string)
      if (duration !== null) updates['duration_ms'] = duration
    }
  }

  // Full snapshot select — same append-only rationale as the trace PATCH.
  const { data, error } = await supabaseAdmin
    .from('spans')
    .update(updates)
    .eq('id', spanId)
    .eq('organization_id', organizationId)
    .select(
      'id, trace_id, parent_span_id, name, span_type, status, started_at, ended_at, duration_ms, input, output, metadata, error_message, prompt_tokens, completion_tokens, total_tokens, cost_usd',
    )
    .single()

  if (error || !data) {
    throw new ApiError('NOT_FOUND', 'Span not found or access denied')
  }

  // R-12 Phase 3.2 — dual-write the span lifecycle update to events.
  // This PATCH is where usage/cost/output land (the SDK creates the span
  // empty, then fills it at end()), so skipping it left every span event
  // with zero tokens forever. project_id comes from the parent trace —
  // spans don't carry one.
  try {
    const { data: parentTrace } = await supabaseAdmin
      .from('traces')
      .select('project_id')
      .eq('id', data.trace_id)
      .eq('organization_id', organizationId)
      .single()
    if (parentTrace?.project_id) {
      await writeSpanAsEvent({
        spanId: data.id,
        traceId: data.trace_id,
        parentSpanId: data.parent_span_id ?? null,
        organizationId,
        projectId: parentTrace.project_id,
        apiKeyId: null,
        name: data.name,
        spanType: data.span_type ?? null,
        startedAt: data.started_at,
        endedAt: data.ended_at ?? null,
        durationMs: data.duration_ms ?? null,
        status: data.status ?? null,
        errorMessage: data.error_message ?? null,
        input: data.input ?? undefined,
        output: data.output ?? undefined,
        metadata: (data.metadata as Record<string, unknown> | null) ?? null,
        promptTokens: data.prompt_tokens ?? null,
        completionTokens: data.completion_tokens ?? null,
        totalTokens: data.total_tokens ?? null,
        costUsd: data.cost_usd ?? null,
        eventTime: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.error('[ingest] span update events shadow INSERT failed:', err instanceof Error ? err.message : err)
  }

  return c.json({ success: true, data })
})
