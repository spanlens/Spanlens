import { supabaseAdmin } from './db.js'

export interface RequestLogData {
  organizationId: string
  projectId: string
  apiKeyId: string
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number | null
  latencyMs: number
  statusCode: number
  requestBody: unknown
  responseBody: unknown
  errorMessage: string | null
  traceId: string | null
  spanId: string | null
}

/**
 * 10KB 초과 body는 DB에 저장하지 않고 truncate — Postgres JSONB 팽창 방지.
 * 전체 본문이 필요한 고객은 향후 Phase 2에서 Supabase Storage 버킷 업로드로 확장 예정.
 * 지금은 preview(앞 2KB) + 원본 크기 메타만 남기고 나머지는 드롭.
 */
const MAX_BODY_INLINE_BYTES = 10 * 1024
const PREVIEW_BYTES = 2 * 1024

function serializeBody(body: unknown): unknown {
  if (body == null) return null

  let serialized: string
  try {
    serialized = typeof body === 'string' ? body : JSON.stringify(body)
  } catch {
    return { _error: 'body not JSON-serializable' }
  }

  const bytes = new TextEncoder().encode(serialized).byteLength
  if (bytes <= MAX_BODY_INLINE_BYTES) return body

  // Truncate — preserve a readable preview plus size metadata for the dashboard
  const preview = serialized.slice(0, PREVIEW_BYTES)
  return {
    _truncated: true,
    _original_size_bytes: bytes,
    _preview: preview,
    _note: `Body exceeded ${MAX_BODY_INLINE_BYTES} bytes and was truncated. Full body storage via Supabase Storage is planned for Phase 2.`,
  }
}

export async function logRequestAsync(data: RequestLogData): Promise<void> {
  const { error } = await supabaseAdmin.from('requests').insert({
    organization_id: data.organizationId,
    project_id: data.projectId,
    api_key_id: data.apiKeyId,
    provider: data.provider,
    model: data.model,
    prompt_tokens: data.promptTokens,
    completion_tokens: data.completionTokens,
    total_tokens: data.totalTokens,
    cost_usd: data.costUsd,
    latency_ms: data.latencyMs,
    status_code: data.statusCode,
    request_body: serializeBody(data.requestBody),
    response_body: serializeBody(data.responseBody),
    error_message: data.errorMessage,
    trace_id: data.traceId,
    span_id: data.spanId,
  })
  if (error) {
    console.error('[logger] Failed to log request:', error.message)
  }
}
