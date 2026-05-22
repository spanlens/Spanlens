import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from './db.js'
import { getClickhouse, toClickhouseTimestamp } from './clickhouse.js'
import { maskApiKeysInBody, maskApiKeys } from './pii-mask.js'
import { scanAll, type SecurityFlag } from './security-scan.js'
import { sendEmail, renderSecurityAlertEmail } from './resend.js'

/**
 * Customer-controlled body logging mode (sent via the `x-spanlens-log-body`
 * header by the SDK helpers `withLogBody()` / `observeOpenAI({ logBody })`).
 *
 * - `'full'` (default): persist request/response bodies after API-key masking.
 * - `'meta'`: drop bodies but keep tokens/latency/cost/model + identifiers.
 * - `'none'`: drop bodies AND user_id/session_id — strictest minimization.
 *
 * See packages/sdk/src/types.ts LogBodyMode for the matching SDK type.
 */
export type LogBodyMode = 'full' | 'meta' | 'none'

/** Header-string → mode. Unknown values fall back to 'full' (no change in behavior). */
export function parseLogBodyMode(header: string | null | undefined): LogBodyMode {
  if (header === 'meta' || header === 'none') return header
  return 'full'
}

export interface RequestLogData {
  organizationId: string
  projectId: string
  apiKeyId?: string | null
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Subset of promptTokens that hit a prompt cache (Anthropic cache_read_input_tokens / OpenAI cached_tokens). */
  cacheReadTokens?: number
  /** Subset of promptTokens that wrote a cache entry (Anthropic cache_creation_input_tokens). */
  cacheWriteTokens?: number
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
  /** Customer-supplied end-user ID (x-spanlens-user header). */
  userId?: string | null
  /** Customer-supplied session ID (x-spanlens-session header). */
  sessionId?: string | null
  /**
   * Pre-computed request flags from the proxy (used for blocking).
   * If provided, logger skips re-scanning the request body.
   */
  preComputedRequestFlags?: SecurityFlag[]
  /**
   * Customer-requested body retention level (x-spanlens-log-body header).
   * Defaults to 'full' when absent — same behavior as before.
   */
  logBodyMode?: LogBodyMode
  /**
   * Set to true when the proxy gracefully closed the request because it was
   * approaching its Vercel function deadline. The row still records whatever
   * tokens/text we managed to capture; consumers (dashboard, SDK, billing)
   * can filter / surface accordingly.
   *
   * See proxy/stream-deadline.ts for the wiring rationale.
   */
  truncated?: boolean
  /**
   * Actual processing tier the provider served the request from. Extracted by
   * parsers from the response body — see parsers/openai.ts (`service_tier`)
   * and parsers/gemini.ts (`usageMetadata.serviceTier`). Used by the cost
   * calculator to apply Flex/Priority multipliers and surfaced on the
   * dashboard for tier-distribution analytics.
   *
   * Empty string written to CH when unknown / unsupported (Anthropic).
   */
  serviceTier?: string | null | undefined
}

/**
 * Bodies above this size are truncated before ClickHouse insertion. ClickHouse
 * compresses well with ZSTD(3) so the inline cap is generous, but we still cap
 * to keep individual rows bounded for cheap scans.
 *
 * Larger bodies are replaced with a preview + size metadata. Phase 2 may move
 * full bodies to object storage and link by reference.
 */
const MAX_BODY_INLINE_BYTES = 64 * 1024
const PREVIEW_BYTES = 2 * 1024

/**
 * Returns the body shape that will go into the ClickHouse `request_body` /
 * `response_body` column. Above the inline cap, replaces with a preview +
 * size envelope; otherwise returns the body as-is for downstream serialization.
 */
function maybeTruncateBody(body: unknown): unknown {
  if (body == null) return null

  let serialized: string
  try {
    serialized = typeof body === 'string' ? body : JSON.stringify(body)
  } catch {
    return { _error: 'body not JSON-serializable' }
  }

  const bytes = new TextEncoder().encode(serialized).byteLength
  if (bytes <= MAX_BODY_INLINE_BYTES) return body

  const preview = serialized.slice(0, PREVIEW_BYTES)
  return {
    _truncated: true,
    _original_size_bytes: bytes,
    _preview: preview,
    _note: `Body exceeded ${MAX_BODY_INLINE_BYTES} bytes and was truncated.`,
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

  // ── ClickHouse insertion ──────────────────────────────────────────────────
  // Body columns + identifiers respect the customer's logBodyMode opt-out.
  //   - full: persist everything with API-key pattern masking (default)
  //   - meta: drop request/response bodies; keep token counts + identifiers
  //   - none: same as meta plus drop user_id / session_id
  // The security scan still runs above so prompt-injection / leaked-key
  // detection works even when bodies are dropped — flagging without storing.
  // The error_message column passes through API-key masking in case an
  // upstream 401 echoed back a key fragment.
  const logBodyMode = data.logBodyMode ?? 'full'
  const storeBody = logBodyMode === 'full'
  const requestBody = storeBody ? maskApiKeysInBody(maybeTruncateBody(data.requestBody)) : ''
  const responseBody = storeBody ? maskApiKeysInBody(maybeTruncateBody(data.responseBody)) : ''
  const errorMessage = data.errorMessage ? maskApiKeys(data.errorMessage) : null

  const dropIdentifiers = logBodyMode === 'none'
  const userId = dropIdentifiers ? null : (data.userId ?? null)
  const sessionId = dropIdentifiers ? null : (data.sessionId ?? null)

  const clickhouseRow = {
    id: randomUUID(),
    organization_id: data.organizationId,
    project_id: data.projectId,
    api_key_id: data.apiKeyId ?? null,
    provider: data.provider,
    model: data.model,
    prompt_tokens: data.promptTokens,
    completion_tokens: data.completionTokens,
    total_tokens: data.totalTokens,
    cache_read_tokens: data.cacheReadTokens ?? 0,
    cache_write_tokens: data.cacheWriteTokens ?? 0,
    cost_usd: data.costUsd,
    latency_ms: data.latencyMs,
    proxy_overhead_ms: data.proxyOverheadMs ?? null,
    status_code: data.statusCode,
    request_body: requestBody,
    response_body: responseBody,
    error_message: errorMessage,
    trace_id: data.traceId,
    span_id: data.spanId,
    prompt_version_id: data.promptVersionId ?? null,
    provider_key_id: data.providerKeyId ?? null,
    user_id: userId,
    session_id: sessionId,
    flags: JSON.stringify(requestFlags),
    response_flags: JSON.stringify(responseFlags),
    has_security_flags: requestFlags.length > 0 || responseFlags.length > 0,
    // 0/1 because ClickHouse UInt8; never null even if the field was
    // never set (older rows backfill via DEFAULT 0 on the column).
    truncated: data.truncated ? 1 : 0,
    // Empty string when unknown — matches the column DEFAULT '' from migration
    // 003_add_service_tier.sql and keeps CH LowCardinality dictionary tight.
    service_tier: data.serviceTier ?? '',
    // ClickHouse DateTime64 wants 'YYYY-MM-DD HH:MM:SS.fff' (no Z).
    // Postgres's gen_random_uuid()/now() defaults moved to the
    // application layer — no behavioral difference, just a different
    // write boundary.
    created_at: toClickhouseTimestamp(),
  }

  try {
    await getClickhouse().insert({
      table: 'requests',
      format: 'JSONEachRow',
      values: [clickhouseRow],
    })
  } catch (err) {
    // ── ClickHouse fallback (P2.6) ─────────────────────────────────────────
    // CH outage / network blip / Development tier cold-start → preserve the
    // row in Supabase `requests_fallback` so the cron replayer can ingest
    // it later. Without this backstop every CH outage silently loses customer
    // billing data and dashboard entries.
    const message = err instanceof Error ? err.message : String(err)
    console.error('[logger] ClickHouse insert failed, queueing to fallback:', message)

    try {
      await supabaseAdmin.from('requests_fallback').insert({
        payload: clickhouseRow,
        organization_id: data.organizationId,
        last_error: message.slice(0, 500),
      })
    } catch (fallbackErr) {
      // Both DBs are down. Nothing more we can do — surface loudly so
      // observability picks it up. The original CH error message is
      // preserved in the log line above for triage.
      const fallbackMessage =
        fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      console.error('[logger] Fallback INSERT also failed — row LOST:', fallbackMessage)
    }
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
