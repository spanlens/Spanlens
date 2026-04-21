import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { supabaseAdmin } from '../lib/db.js'

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

// ── POST /ingest/traces ──────────────────────────────────────
ingestRouter.post('/traces', async (c) => {
  const organizationId = c.get('organizationId')
  const projectId = c.get('projectId')
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
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required' }, 400)
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
    return c.json({ error: 'Failed to create trace', detail: error?.message }, 500)
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
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.status === 'string' && VALID_TRACE_STATUS.has(body.status as TraceStatus)) {
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
    return c.json({ error: 'No valid fields to update' }, 400)
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

  const { data, error } = await supabaseAdmin
    .from('traces')
    .update(updates)
    .eq('id', traceId)
    .eq('organization_id', organizationId)
    .select('id, status, ended_at, duration_ms')
    .single()

  if (error || !data) {
    return c.json({ error: 'Trace not found or access denied' }, 404)
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
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required' }, 400)
  }

  // trace 소유권 확인 — 다른 org의 trace에 span 추가 시도 차단
  const { data: trace } = await supabaseAdmin
    .from('traces')
    .select('id')
    .eq('id', traceId)
    .eq('organization_id', organizationId)
    .single()
  if (!trace) return c.json({ error: 'Trace not found' }, 404)

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
    return c.json({ error: 'Failed to create span', detail: error?.message }, 500)
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
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.status === 'string' && VALID_SPAN_STATUS.has(body.status as SpanStatus)) {
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
    return c.json({ error: 'No valid fields to update' }, 400)
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

  const { data, error } = await supabaseAdmin
    .from('spans')
    .update(updates)
    .eq('id', spanId)
    .eq('organization_id', organizationId)
    .select('id, status, ended_at, duration_ms, total_tokens, cost_usd')
    .single()

  if (error || !data) {
    return c.json({ error: 'Span not found or access denied' }, 404)
  }

  return c.json({ success: true, data })
})
