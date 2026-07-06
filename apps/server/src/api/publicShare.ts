import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { supabaseAdmin } from '../lib/db.js'
import { computeCriticalPath } from '../lib/critical-path.js'
import { maskApiKeys } from '../lib/pii-mask.js'
import {
  requestsScope,
  selectRequests,
  fetchProviderKeyNames,
} from '../lib/requests-query.js'
import { fromClickhouseTimestamp } from '../lib/clickhouse.js'
import { checkRateLimit } from '../lib/rate-limit.js'
import { fireAndForget } from '../lib/wait-until.js'
import { ApiError } from '../lib/errors.js'

/**
 * Public share viewer (PLG Loop ①). Mounted at `/share/:token` on the root
 * Hono app — NOT under /api/v1 so it does not pass through authJwt.
 *
 * Trust model: the token in the URL is the only credential. Owner-side
 * creation (api/shares.ts) verified the target belongs to the org at issue
 * time, so we only need to:
 *   1. Resolve the token,
 *   2. Reject expired / revoked,
 *   3. Load the target with the share's redaction flags applied,
 *   4. Bump view_count.
 *
 * For expired / missing / revoked all three return 404 with the same body
 * so an attacker cannot distinguish "this token existed once" from "this
 * token never existed" via timing or status code (token enumeration defence).
 */

export const publicShareRouter = new Hono()

// Per-IP sliding window. Public path, no auth — IP is the only stable key.
// 60 req/min is generous for normal viewers (Slack unfurl + a few browser
// tabs) but blocks scrapers / enumeration loops.
const PUBLIC_SHARE_RATE_LIMIT = 60

const publicRateLimit = createMiddleware(async (c, next) => {
  // Vercel sets x-forwarded-for; fall back to a synthetic key so the limit
  // is at least applied per-token if the header is missing (e.g. local dev).
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    `token:${c.req.param('token') ?? 'unknown'}`

  const allowed = await checkRateLimit(`share:${ip}`, PUBLIC_SHARE_RATE_LIMIT)
  if (!allowed) {
    c.header('Retry-After', '60')
    throw new ApiError('RATE_LIMIT', 'Too many requests')
  }
  return next()
})

publicShareRouter.use('*', publicRateLimit)

interface SharedLink {
  scope: string
  target_id: string
  organization_id: string
  redact_pii: boolean
  redact_cost: boolean
  redact_tokens: boolean
  indexable: boolean
  expires_at: string | null
  revoked_at: string | null
  view_count: number
  created_at: string
}

function isExpired(expires_at: string | null): boolean {
  if (!expires_at) return false
  return Date.parse(expires_at) <= Date.now()
}

const NOT_FOUND_BODY = { error: 'This share link has expired or does not exist.' }

publicShareRouter.get('/:token', async (c) => {
  const token = c.req.param('token')
  if (!token || token.length < 8 || token.length > 128) {
    return c.json(NOT_FOUND_BODY, 404)
  }

  const { data: share } = await supabaseAdmin
    .from('shared_links')
    .select(
      'scope, target_id, organization_id, redact_pii, redact_cost, redact_tokens, indexable, expires_at, revoked_at, view_count, created_at',
    )
    .eq('token', token)
    .maybeSingle<SharedLink>()

  if (!share || share.revoked_at || isExpired(share.expires_at)) {
    return c.json(NOT_FOUND_BODY, 404)
  }

  let payload: unknown
  try {
    payload =
      share.scope === 'trace'
        ? await loadTraceForShare(share)
        : await loadRequestForShare(share)
  } catch (err) {
    console.error('[share:get] payload load failed:', err instanceof Error ? err.message : err)
    return c.json(NOT_FOUND_BODY, 404)
  }
  if (!payload) return c.json(NOT_FOUND_BODY, 404)

  // PLG Loop ② — the "Observed by Spanlens" footer can be hidden only while
  // the share's org sits on team or enterprise. Free/Starter forces it on
  // even if the column is true (e.g. lingering from a previous Team window).
  const hidePoweredBy = await shouldHidePoweredBy(share.organization_id)

  // Bump view_count. Fire-and-forget — a viewer should never see a 500 because
  // the counter update failed. Wrapped in fireAndForget so the pending promise
  // survives on Vercel (a bare .then() is dropped on Edge/serverless — gotcha
  // #8). Atomic increment via RPC avoids the read-modify-write lost-update race
  // under concurrent viewers (supabase-js .update() cannot express
  // `view_count = view_count + 1`).
  fireAndForget(
    c,
    // Promise.resolve() because supabase-js returns a thenable PostgrestBuilder
    // (PromiseLike), not a real Promise, and fireAndForget expects a Promise.
    Promise.resolve(
      supabaseAdmin
        .rpc('increment_share_view_count', { p_token: token })
        .then(({ error }) => {
          if (error) console.error('[share:get] view_count bump failed:', error.message)
        }),
    ),
  )

  return c.json({
    success: true,
    data: {
      scope: share.scope,
      indexable: share.indexable,
      createdAt: share.created_at,
      expiresAt: share.expires_at,
      viewCount: share.view_count + 1,
      hidePoweredBy,
      payload,
    },
  })
})

/**
 * PLG Loop ② gate. Free/Starter always render the footer regardless of the
 * stored preference — those tiers are where the badge does its compounding
 * distribution work. Team/Enterprise honour the org's setting.
 */
async function shouldHidePoweredBy(organizationId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('plan, hide_powered_by_badge')
    .eq('id', organizationId)
    .single()
  if (!data) return false
  const plan = data.plan as string | null
  const hide = data.hide_powered_by_badge === true
  return hide && (plan === 'team' || plan === 'enterprise')
}

// ── Trace loader ────────────────────────────────────────────────────────────

interface TraceRow {
  id: string
  name: string | null
  status: string
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  span_count: number | null
  total_tokens: number | null
  total_cost_usd: number | string | null
  error_message: string | null
}

interface SpanRow {
  id: string
  parent_span_id: string | null
  name: string | null
  span_type: string | null
  status: string | null
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  input: unknown
  output: unknown
  metadata: unknown
  error_message: string | null
  request_id: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost_usd: number | string | null
}

async function loadTraceForShare(share: SharedLink): Promise<unknown> {
  const { data: trace } = await supabaseAdmin
    .from('traces')
    .select(
      'id, name, status, started_at, ended_at, duration_ms, span_count, total_tokens, total_cost_usd, error_message',
    )
    .eq('id', share.target_id)
    .eq('organization_id', share.organization_id)
    .maybeSingle<TraceRow>()
  if (!trace) return null

  const { data: spansRaw } = await supabaseAdmin
    .from('spans')
    .select(
      'id, parent_span_id, name, span_type, status, started_at, ended_at, duration_ms, input, output, metadata, error_message, request_id, prompt_tokens, completion_tokens, total_tokens, cost_usd',
    )
    .eq('trace_id', share.target_id)
    .order('started_at', { ascending: true })
  const spans: SpanRow[] = (spansRaw ?? []) as unknown as SpanRow[]

  const criticalSpanIds = computeCriticalPath(spans)

  const redacted = {
    ...trace,
    total_cost_usd: share.redact_cost ? null : trace.total_cost_usd,
    total_tokens: share.redact_tokens ? null : trace.total_tokens,
    spans: spans.map((s) => sanitizeSpan(s, share)),
    critical_span_ids: criticalSpanIds,
  }
  return redacted
}

function sanitizeSpan(span: SpanRow, share: SharedLink) {
  const input = sanitizeJson(span.input, share.redact_pii)
  const output = sanitizeJson(span.output, share.redact_pii)
  const metadata = sanitizeJson(span.metadata, share.redact_pii)
  return {
    ...span,
    input,
    output,
    metadata,
    cost_usd: share.redact_cost ? null : span.cost_usd,
    prompt_tokens: share.redact_tokens ? null : span.prompt_tokens,
    completion_tokens: share.redact_tokens ? null : span.completion_tokens,
    total_tokens: share.redact_tokens ? null : span.total_tokens,
  }
}

function sanitizeJson(value: unknown, redactPii: boolean): unknown {
  if (!redactPii || value == null) return value
  if (typeof value === 'string') return maskApiKeys(value)
  try {
    return JSON.parse(maskApiKeys(JSON.stringify(value)))
  } catch {
    return value
  }
}

// ── Request loader (ClickHouse) ─────────────────────────────────────────────

interface RequestDetailRow {
  id: string
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: string | number | null
  latency_ms: number
  status_code: number
  request_body: string
  response_body: string
  error_message: string | null
  trace_id: string | null
  span_id: string | null
  provider_key_id: string | null
  truncated: number | boolean
  created_at: string
}

const REQUEST_SHARE_COLUMNS =
  'id, provider, model, prompt_tokens, completion_tokens, total_tokens, ' +
  'cost_usd, latency_ms, status_code, request_body, response_body, error_message, ' +
  'trace_id, span_id, provider_key_id, truncated, created_at'

async function loadRequestForShare(share: SharedLink): Promise<unknown> {
  // ignoreRetention so a share that outlives the org's retention window keeps
  // working until the underlying ClickHouse TTL (365 days) drops the row.
  const scope = await requestsScope(share.organization_id, { ignoreRetention: true })
  const rows = await selectRequests<RequestDetailRow>({
    scope,
    select: REQUEST_SHARE_COLUMNS,
    filters: 'id = {requestId:UUID}',
    params: { requestId: share.target_id },
    limit: 1,
  })
  const data = rows[0]
  if (!data) return null

  const keyMap = await fetchProviderKeyNames(share.organization_id, [data.provider_key_id])

  const reqBody = parseJsonString(data.request_body)
  const resBody = parseJsonString(data.response_body)

  return {
    id: data.id,
    provider: data.provider,
    model: data.model,
    latency_ms: data.latency_ms,
    status_code: data.status_code,
    error_message: data.error_message,
    trace_id: data.trace_id,
    span_id: data.span_id,
    provider_key_name: data.provider_key_id ? (keyMap.get(data.provider_key_id) ?? null) : null,
    truncated: Boolean(Number(data.truncated)),
    created_at: fromClickhouseTimestamp(data.created_at) ?? data.created_at,
    cost_usd: share.redact_cost
      ? null
      : data.cost_usd == null
        ? null
        : Number(data.cost_usd),
    prompt_tokens: share.redact_tokens ? null : data.prompt_tokens,
    completion_tokens: share.redact_tokens ? null : data.completion_tokens,
    total_tokens: share.redact_tokens ? null : data.total_tokens,
    request_body: sanitizeJson(reqBody, share.redact_pii),
    response_body: sanitizeJson(resBody, share.redact_pii),
  }
}

function parseJsonString(value: string | null | undefined): unknown {
  if (value == null || value === '') return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
