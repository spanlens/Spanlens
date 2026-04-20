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
    request_body: data.requestBody,
    response_body: data.responseBody,
    error_message: data.errorMessage,
    trace_id: data.traceId,
    span_id: data.spanId,
  })
  if (error) {
    console.error('[logger] Failed to log request:', error.message)
  }
}
