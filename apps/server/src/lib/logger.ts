import { supabaseAdmin } from './db.js'
import { scanAll, type SecurityFlag } from './security-scan.js'
import { sendEmail, renderSecurityAlertEmail } from './resend.js'

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
  /** Pre-fetch proxy overhead: auth + key decryption + body parsing (ms). Target p95 < 50ms. */
  proxyOverheadMs?: number | null
  statusCode: number
  requestBody: unknown
  responseBody: unknown
  errorMessage: string | null
  traceId: string | null
  spanId: string | null
  promptVersionId?: string | null
  providerKeyId?: string | null
  /**
   * Pre-computed request flags from the proxy (used for blocking).
   * If provided, logger skips re-scanning the request body.
   */
  preComputedRequestFlags?: SecurityFlag[]
}

/**
 * 64KB 초과 body는 DB에 저장하지 않고 truncate — Postgres JSONB 팽창 방지.
 * 전체 본문이 필요한 고객은 향후 Phase 2에서 Supabase Storage 버킷 업로드로 확장 예정.
 * 지금은 preview(앞 2KB) + 원본 크기 메타만 남기고 나머지는 드롭.
 */
const MAX_BODY_INLINE_BYTES = 64 * 1024
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

/** Rate-limit: 5 minutes between security alert emails per org. */
const ALERT_COOLDOWN_MS = 5 * 60 * 1000

/**
 * Sends a security alert email to the org owner if:
 *   1. The org has security_alert_enabled = true
 *   2. No alert was sent in the last 5 minutes (rate limit via last_security_alert_at)
 *
 * Race-condition-safe: uses a single atomic UPDATE...WHERE to claim the alert
 * slot. If another concurrent request already claimed it, the UPDATE affects 0
 * rows and we bail early — no duplicate emails are sent.
 *
 * Never throws — failure is logged and silently ignored.
 */
async function maybeSendSecurityAlert(params: {
  organizationId: string
  projectId: string
  requestFlags: SecurityFlag[]
  responseFlags: SecurityFlag[]
}): Promise<void> {
  const { organizationId, projectId, requestFlags, responseFlags } = params

  const cooldownTimestamp = new Date(Date.now() - ALERT_COOLDOWN_MS).toISOString()

  // Atomic claim: update only if alert is enabled AND cooldown has elapsed.
  // Using a single UPDATE+WHERE eliminates the TOCTOU race between a separate
  // read-check and a subsequent write.
  const { data: claimedOrg } = await supabaseAdmin
    .from('organizations')
    .update({ last_security_alert_at: new Date().toISOString() })
    .eq('id', organizationId)
    .eq('security_alert_enabled', true)
    .or(`last_security_alert_at.is.null,last_security_alert_at.lt.${cooldownTimestamp}`)
    .select('name')
    .single()

  // If no row was returned, alert is disabled or still in cooldown — skip.
  if (!claimedOrg) return

  // Fetch project name and owner in parallel to reduce sequential DB round-trips
  const [projectResult, ownerResult] = await Promise.all([
    supabaseAdmin.from('projects').select('name').eq('id', projectId).single(),
    supabaseAdmin
      .from('org_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('role', 'owner')
      .limit(1),
  ])

  const ownerId = ownerResult.data?.[0]?.user_id
  if (!ownerId) return

  const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(ownerId)
  const ownerEmail = user?.email
  if (!ownerEmail) return

  // Send email
  const webUrl = process.env.WEB_URL ?? 'http://localhost:3000'
  const { subject, html } = renderSecurityAlertEmail({
    orgName: claimedOrg.name,
    projectName: projectResult.data?.name ?? projectId,
    requestFlags,
    responseFlags,
    dashboardUrl: `${webUrl}/security`,
  })

  const result = await sendEmail({ to: ownerEmail, subject, html })
  if (!result.sent && result.error) {
    // Log only error message, not ownerEmail, to avoid PII in logs
    console.error('[security-alert] sendEmail failed:', result.error)
  }
}

export async function logRequestAsync(data: RequestLogData): Promise<void> {
  // ── Security scan ──────────────────────────────────────────────────────────
  // Request flags: use pre-computed from proxy (blocking path) or scan fresh.
  let requestFlags: SecurityFlag[] = []
  try {
    requestFlags = data.preComputedRequestFlags ?? scanAll(data.requestBody)
  } catch {
    requestFlags = []
  }

  // Response flags: always scan the response body.
  let responseFlags: SecurityFlag[] = []
  try {
    responseFlags = scanAll(data.responseBody)
  } catch {
    responseFlags = []
  }

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
    proxy_overhead_ms: data.proxyOverheadMs ?? null,
    status_code: data.statusCode,
    request_body: serializeBody(data.requestBody),
    response_body: serializeBody(data.responseBody),
    error_message: data.errorMessage,
    trace_id: data.traceId,
    span_id: data.spanId,
    prompt_version_id: data.promptVersionId ?? null,
    provider_key_id: data.providerKeyId ?? null,
    flags: requestFlags,
    response_flags: responseFlags,
  })
  if (error) {
    console.error('[logger] Failed to log request:', error.message)
  }

  // ── Security alert ────────────────────────────────────────────────────────
  // Awaited here so the entire alert chain is drained within the outer
  // fireAndForget(c, logRequestAsync(...)) waitUntil budget. A detached
  // .catch()-only promise would escape waitUntil on Vercel Edge and be silently
  // dropped mid-execution (CLAUDE.md gotcha #8).
  if (requestFlags.length > 0 || responseFlags.length > 0) {
    await maybeSendSecurityAlert({
      organizationId: data.organizationId,
      projectId: data.projectId,
      requestFlags,
      responseFlags,
    }).catch((err) => {
      console.error('[security-alert] failed:', err instanceof Error ? err.message : String(err))
    })
  }
}
