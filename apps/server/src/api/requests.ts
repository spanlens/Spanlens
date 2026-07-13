import { Hono } from 'hono'
import type { JwtContext } from '../middleware/authJwt.js'
import { authJwtOrApiKey } from '../middleware/authJwtOrApiKey.js'
import { requireRole } from '../middleware/requireRole.js'
import { getDecryptedProviderKeyById, getDecryptedProviderKey } from '../proxy/utils.js'
import { calculateCost, type Provider } from '../lib/cost.js'
import {
  REPLAY_RUN_SUPPORTED_PROVIDERS,
  buildReplayProxyPath,
  buildReplayUpstream,
  parseReplayUsage,
} from '../lib/replay-providers.js'
import { logRequestAsync } from '../lib/logger.js'
import { fireAndForget } from '../lib/wait-until.js'
import { parsePageLimit, validateOptionalUuid, validateOptionalDate, isUuid } from '../lib/params.js'
import {
  requestsScope,
  selectRequests,
  countRequests,
  fetchProviderKeyNames,
} from '../lib/requests-query.js'
import {
  eventsScope,
  selectGenerationsAsRequests,
  countGenerations,
} from '../lib/events-query.js'
import { useEventsForRequests } from '../lib/events-read-flag.js'
import { fromClickhouseTimestamp } from '../lib/clickhouse.js'
import { ApiError } from '../lib/errors.js'

export const requestsRouter = new Hono<JwtContext>()

requestsRouter.use('*', authJwtOrApiKey)

// Columns surfaced in the list view. Kept in sync with the response contract
// the dashboard expects (provider_key_name is flattened from provider_keys.name
// via fetchProviderKeyNames after the main read).
const LIST_COLUMNS =
  'id, project_id, provider, model, prompt_tokens, completion_tokens, total_tokens, ' +
  'cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, status_code, error_message, ' +
  'trace_id, span_id, provider_key_id, user_id, session_id, truncated, created_at'

interface RequestRow {
  id: string
  project_id: string
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: string | number | null
  latency_ms: number
  status_code: number
  error_message: string | null
  trace_id: string | null
  span_id: string | null
  provider_key_id: string | null
  user_id: string | null
  session_id: string | null
  /** ClickHouse UInt8 → number on the wire; we coerce to boolean at the API boundary. */
  truncated: number | boolean
  created_at: string
}

// GET /api/v1/requests — list requests with optional filters + pagination
// Query params: projectId, provider, model, status, from, to, page, limit
requestsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  // UUID + date params are bound into ClickHouse {x:UUID} / parseDateTime64
  // placeholders. A malformed value (e.g. ?projectId=abc, ?from=garbage) fails
  // the binding and throws a raw 500 — validate up front so these documented
  // external surfaces (MCP/BI tools pass arbitrary filter args) get a clean 400.
  const projectId       = validateOptionalUuid(c.req.query('projectId'), 'projectId')
  const provider        = c.req.query('provider')
  const model           = c.req.query('model')
  const from            = validateOptionalDate(c.req.query('from'), 'from')
  const to              = validateOptionalDate(c.req.query('to'), 'to')
  const providerKeyId   = validateOptionalUuid(c.req.query('providerKeyId'), 'providerKeyId')
  const promptVersionId = validateOptionalUuid(c.req.query('promptVersionId'), 'promptVersionId')
  const userIdFilter    = c.req.query('userId')
  const sessionIdFilter = c.req.query('sessionId')
  const status          = c.req.query('status')
  const sortByRaw       = c.req.query('sortBy')
  const sortDirRaw      = c.req.query('sortDir')
  const { page, limit, offset } = parsePageLimit(c.req.query('page'), c.req.query('limit'))

  const validSortCols = ['created_at', 'latency_ms', 'cost_usd', 'total_tokens'] as const
  type SortCol = (typeof validSortCols)[number]
  const sortCol: SortCol = validSortCols.includes(sortByRaw as SortCol)
    ? (sortByRaw as SortCol)
    : 'created_at'
  const orderDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC'
  // ClickHouse: NULLS LAST mimics Supabase's nullsFirst: false.
  const orderBy = `${sortCol} ${orderDir} NULLS LAST`

  // Assemble the dynamic WHERE. Each fragment is a parametrized ClickHouse
  // condition — never interpolate user input into the SQL string itself.
  const filters: string[] = []
  const params: Record<string, unknown> = {}

  if (projectId)       { filters.push('project_id = {projectId:UUID}'); params['projectId'] = projectId }
  if (provider)        { filters.push('provider = {provider:String}'); params['provider'] = provider }
  if (model)           { filters.push('positionCaseInsensitive(model, {model:String}) > 0'); params['model'] = model }
  if (providerKeyId)   { filters.push('provider_key_id = {providerKeyId:UUID}'); params['providerKeyId'] = providerKeyId }
  if (promptVersionId) { filters.push('prompt_version_id = {promptVersionId:UUID}'); params['promptVersionId'] = promptVersionId }
  if (userIdFilter)    { filters.push('user_id = {userId:String}'); params['userId'] = userIdFilter }
  if (sessionIdFilter) { filters.push('session_id = {sessionId:String}'); params['sessionId'] = sessionIdFilter }
  if (from)            { filters.push('created_at >= parseDateTime64BestEffort({from:String})'); params['from'] = from }
  if (to)              { filters.push('created_at <= parseDateTime64BestEffort({to:String})'); params['to'] = to }

  // Accept friendly `success`/`error` synonyms alongside the original
  // `ok`/`4xx`/`5xx` enum so callers without HTTP intuition (MCP tools,
  // BI dashboards) can filter without knowing status-code ranges.
  if (status === 'ok' || status === 'success')   filters.push('status_code < 400')
  else if (status === '4xx')                     filters.push('status_code >= 400 AND status_code < 500')
  else if (status === '5xx')                     filters.push('status_code >= 500')
  else if (status === 'error')                   filters.push('status_code >= 400')

  // ?truncated=true  → only rows that hit the stream deadline
  // ?truncated=false → only rows that completed cleanly
  // (omit) → no filter
  const truncatedRaw = c.req.query('truncated')
  if (truncatedRaw === 'true')  filters.push('truncated = 1')
  else if (truncatedRaw === 'false') filters.push('truncated = 0')

  const combinedFilters = filters.length > 0 ? filters.join(' AND ') : undefined

  try {
    let rows: RequestRow[]
    let total: number

    if (await useEventsForRequests(orgId)) {
      // Phase 5.1 Stage 3 — read from the unified events table.
      // R-12 Phase 3.2: resolved per-org (env gate OR organizations.read_from_events).
      //
      // Safety net: if the events path throws for ANY reason — schema
      // drift, missing column, retention edge case — fall back to the
      // requests path so the dashboard never shows an empty list due
      // to an internal Stage 3 issue. The error is logged loudly so
      // a sustained outage is visible in Vercel logs.
      let usedFallback = false
      try {
        const eventsScopeResolved = await eventsScope(orgId)
        ;[rows, total] = await Promise.all([
          selectGenerationsAsRequests<RequestRow>({
            scope: eventsScopeResolved,
            filters: combinedFilters,
            orderBy,
            limit,
            offset,
            params,
          }),
          countGenerations({ scope: eventsScopeResolved, filters: combinedFilters, params }),
        ])
      } catch (eventsErr) {
        // Phase 5.1 Stage 3 root-cause hunt — print everything so the
        // Vercel log makes the failure debuggable from one record.
        console.error('[requests:list] events path failed, falling back to requests table:', {
          message: eventsErr instanceof Error ? eventsErr.message : String(eventsErr),
          stack: eventsErr instanceof Error ? eventsErr.stack : undefined,
          orgId,
          combinedFilters,
          orderBy,
          limit,
          offset,
          params,
        })
        usedFallback = true
        const scope = await requestsScope(orgId)
        ;[rows, total] = await Promise.all([
          selectRequests<RequestRow>({
            scope,
            select: LIST_COLUMNS,
            filters: combinedFilters,
            orderBy,
            limit,
            offset,
            params,
          }),
          countRequests({ scope, filters: combinedFilters, params }),
        ])
      }
      void usedFallback
    } else {
      const scope = await requestsScope(orgId)
      ;[rows, total] = await Promise.all([
        selectRequests<RequestRow>({
          scope,
          select: LIST_COLUMNS,
          filters: combinedFilters,
          orderBy,
          limit,
          offset,
          params,
        }),
        countRequests({ scope, filters: combinedFilters, params }),
      ])
    }

    // App-layer replacement for Supabase's `provider_keys ( name )` nested select.
    const keyMap = await fetchProviderKeyNames(orgId, rows.map((r) => r.provider_key_id))
    const flat = rows.map((row) => ({
      ...row,
      cost_usd: row.cost_usd == null ? null : Number(row.cost_usd),
      // ClickHouse returns UInt8 as a number ("0" / "1" depending on driver); normalize.
      truncated: Boolean(Number(row.truncated)),
      // ClickHouse DateTime64 format ('YYYY-MM-DD HH:MM:SS.fff') has no 'T'/'Z'
      // so JS new Date() interprets as local time → "9h ago" bug for KST users.
      // Convert to canonical ISO UTC at the API boundary. See gotcha #18.
      created_at: fromClickhouseTimestamp(row.created_at) ?? row.created_at,
      provider_key_name: row.provider_key_id ? (keyMap.get(row.provider_key_id) ?? null) : null,
    }))

    return c.json({
      success: true,
      data: flat,
      meta: { total, page, limit },
    })
  } catch (err) {
    console.error('[requests:list] ClickHouse query failed:', err instanceof Error ? err.message : err)
    throw new ApiError('INTERNAL_ERROR', 'Failed to fetch requests')
  }
})

// Columns surfaced in the detail view. Bodies are stored as JSON strings in
// ClickHouse (not JSONB); we parse them at the boundary so the dashboard
// keeps receiving objects.
const DETAIL_COLUMNS =
  'id, organization_id, project_id, api_key_id, provider, model, ' +
  'prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_write_tokens, ' +
  'cost_usd, latency_ms, proxy_overhead_ms, status_code, request_body, response_body, ' +
  'error_message, trace_id, span_id, prompt_version_id, provider_key_id, ' +
  'user_id, session_id, flags, response_flags, has_security_flags, truncated, created_at'

interface RequestDetailRow extends RequestRow {
  organization_id: string
  api_key_id: string | null
  proxy_overhead_ms: number | null
  request_body: string
  response_body: string
  prompt_version_id: string | null
  flags: string
  response_flags: string
  has_security_flags: boolean
}

function parseJsonColumn(value: string | null | undefined, fallback: unknown): unknown {
  if (value == null || value === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

// GET /api/v1/requests/:id — get full request detail including bodies
requestsRouter.get('/:id', async (c) => {
  const requestId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  try {
    const scope = await requestsScope(orgId)
    const rows = await selectRequests<RequestDetailRow>({
      scope,
      select: DETAIL_COLUMNS,
      filters: 'id = {requestId:UUID}',
      params: { requestId },
      limit: 1,
    })
    const data = rows[0]
    if (!data) throw new ApiError('NOT_FOUND', 'Request not found')

    const keyMap = await fetchProviderKeyNames(orgId, [data.provider_key_id])
    const flat = {
      ...data,
      cost_usd: data.cost_usd == null ? null : Number(data.cost_usd),
      truncated: Boolean(Number(data.truncated)),
      // ClickHouse timestamp → ISO UTC (see gotcha #18 / list endpoint).
      created_at: fromClickhouseTimestamp(data.created_at) ?? data.created_at,
      request_body: parseJsonColumn(data.request_body, null),
      response_body: parseJsonColumn(data.response_body, null),
      flags: parseJsonColumn(data.flags, []),
      response_flags: parseJsonColumn(data.response_flags, []),
      provider_key_name: data.provider_key_id ? (keyMap.get(data.provider_key_id) ?? null) : null,
    }
    return c.json({ success: true, data: flat })
  } catch (err) {
    console.error('[requests:detail] ClickHouse query failed:', err instanceof Error ? err.message : err)
    throw new ApiError('NOT_FOUND', 'Request not found')
  }
})

// POST /api/v1/requests/:id/replay
// Re-send a previous request through the proxy, optionally with a different
// model. Looks up the original request body, validates the user owns it, and
// returns a payload the dashboard can re-fetch via the regular SDK path.
//
// We do NOT execute the request server-to-server — that would bypass the
// usual quota / overage / observability path. Instead we return a curl-ready
// snippet + a "replay token" the client uses to fire the call from the
// browser, going back through /proxy/* like a normal SDK call.
//
// Auth: admin/editor only. viewer cannot trigger replay actions — even
// the curl flow eventually consumes the org's provider key budget when
// the user runs the snippet.
requestsRouter.post('/:id/replay', requireRole('admin', 'editor'), async (c) => {
  const requestId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  // Malformed id would fail the ClickHouse {requestId:UUID} binding → raw 500.
  // Treat it like a nonexistent id (same 404 as GET /:id).
  if (!isUuid(requestId)) throw new ApiError('NOT_FOUND', 'Request not found')

  let body: { model?: unknown } = {}
  try {
    body = (await c.req.json()) as { model?: unknown }
  } catch {
    body = {}
  }
  const overrideModel = typeof body.model === 'string' ? body.model : undefined

  interface ReplayRow {
    provider: string
    model: string
    request_body: string
  }
  const scope = await requestsScope(orgId)
  const rows = await selectRequests<ReplayRow>({
    scope,
    select: 'provider, model, request_body',
    filters: 'id = {requestId:UUID}',
    params: { requestId },
    limit: 1,
  })
  const data = rows[0]
  if (!data) throw new ApiError('NOT_FOUND', 'Request not found')

  const original = (parseJsonColumn(data.request_body, {}) ?? {}) as Record<string, unknown>
  const replayBody = overrideModel
    ? { ...original, model: overrideModel }
    : original

  // Strip truncation markers (set by logger.maybeTruncateBody when the original
  // body exceeded 64KB). Replays of truncated bodies are best-effort.
  if (
    typeof replayBody === 'object' &&
    replayBody !== null &&
    '_truncated' in replayBody
  ) {
    throw new ApiError(
      'BODY_NOT_REPLAYABLE',
      'Original request body was truncated and cannot be replayed exactly. Re-send manually from your application.',
    )
  }

  // Build provider-specific proxy path for the curl snippet. The mapping
  // covers all 10 proxied providers (OpenAI-compatible ones mount at
  // /proxy/<p>/v1, azure at /proxy/azure, gemini encodes the model in the
  // URL) — see lib/replay-providers.ts.
  const model = (overrideModel ?? data.model ?? '') as string
  const proxyPath = buildReplayProxyPath(data.provider, model)

  return c.json({
    success: true,
    data: {
      provider: data.provider,
      replayBody,
      proxyPath,
    },
  })
})

// POST /api/v1/requests/:id/replay/run
// Execute a replay directly from the dashboard (JWT auth).
// Calls the upstream provider API (non-streaming), logs the result, and
// returns latency / token counts / cost so the UI can show them inline.
//
// Auth: admin/editor only. This endpoint decrypts and uses the org's
// provider key to make a real, billable upstream call — viewer must not
// be able to spend the org's API budget.
requestsRouter.post('/:id/replay/run', requireRole('admin', 'editor'), async (c) => {
  const requestId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  // Malformed id would fail the ClickHouse {requestId:UUID} binding → raw 500.
  // Treat it like a nonexistent id (same 404 as GET /:id).
  if (!isUuid(requestId)) throw new ApiError('NOT_FOUND', 'Request not found')

  let body: { model?: unknown } = {}
  try { body = (await c.req.json()) as { model?: unknown } } catch { body = {} }
  const overrideModel = typeof body.model === 'string' ? body.model : undefined

  // ── Fetch original request ────────────────────────────────────────────────
  interface ReplayRunRow {
    project_id: string
    provider: string
    model: string
    request_body: string
    provider_key_id: string | null
    api_key_id: string | null
  }
  const scope = await requestsScope(orgId)
  const rows = await selectRequests<ReplayRunRow>({
    scope,
    select: 'project_id, provider, model, request_body, provider_key_id, api_key_id',
    filters: 'id = {requestId:UUID}',
    params: { requestId },
    limit: 1,
  })
  const data = rows[0]
  if (!data) throw new ApiError('NOT_FOUND', 'Request not found')

  const original = (parseJsonColumn(data.request_body, {}) ?? {}) as Record<string, unknown>
  if ('_truncated' in original) {
    throw new ApiError(
      'BODY_NOT_REPLAYABLE',
      'Original request body was truncated and cannot be replayed exactly.',
    )
  }

  // ── Decrypt provider key ──────────────────────────────────────────────────
  // Prefer the historical provider_key_id (the exact key the original call
  // used). Fall back to "current active provider key for this Spanlens key
  // + provider" when the original key has been rotated/deleted.
  let providerKey = data.provider_key_id
    ? await getDecryptedProviderKeyById(data.provider_key_id, orgId)
    : null

  if (!providerKey && data.api_key_id) {
    providerKey = await getDecryptedProviderKey(data.api_key_id, data.provider)
  }

  if (!providerKey) throw new ApiError('BAD_REQUEST', 'Provider key not found or inactive')

  // ── Build replay body (force non-streaming) ───────────────────────────────
  // We force non-streaming because the dashboard expects a single JSON
  // response with token usage. Removing `stream` alone is insufficient —
  // OpenAI rejects `stream_options` (e.g. `{ include_usage: true }`)
  // unless `stream: true`, returning HTTP 400. Strip every stream-related
  // field defensively so any provider's "non-streaming" call shape is valid.
  const replayBody: Record<string, unknown> = { ...original }
  delete replayBody.stream
  delete replayBody.stream_options
  if (overrideModel) replayBody.model = overrideModel
  const model = (replayBody.model ?? data.model ?? '') as string

  // ── Resolve upstream endpoint + headers ───────────────────────────────────
  // OpenAI-compatible providers (mistral, openrouter, groq, deepseek, xai,
  // cohere) reuse the OpenAI chat-completions replay shape against their own
  // upstream base. Azure stays unsupported: its base URL is per-key
  // (provider_metadata.resource_url), so the error names what IS supported.
  const provider = data.provider
  const upstream = buildReplayUpstream(provider, model, providerKey.plaintext)
  if (!upstream) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `Replay run is not supported for provider "${provider}". ` +
        `Supported providers: ${REPLAY_RUN_SUPPORTED_PROVIDERS.join(', ')}. ` +
        'Use POST /:id/replay to get a curl snippet instead.',
    )
  }
  const { url: upstreamUrl, headers: upstreamHeaders } = upstream

  // ── Call upstream ─────────────────────────────────────────────────────────
  const startMs = Date.now()
  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(replayBody),
    })
  } catch (fetchErr) {
    throw new ApiError('UPSTREAM_FAILED', `Failed to reach upstream: ${String(fetchErr)}`)
  }

  const latencyMs = Date.now() - startMs
  const statusCode = upstreamRes.status
  const resBody = (await upstreamRes.json().catch(() => ({}))) as Record<string, unknown>

  if (!upstreamRes.ok) {
    const errMsg = (resBody.error as Record<string, unknown> | undefined)?.message as string | undefined
    // Proxy passthrough — preserve the upstream status code dynamically
    // rather than mapping into the ApiError catalog (which would lock
    // the response to a fixed 502 UPSTREAM_FAILED status). The dashboard
    // "Run again" feature shows the original upstream status next to
    // the original message, so this single endpoint intentionally keeps
    // the legacy c.json shape. Marked here so the next migration sweep
    // does not "fix" it.
    return c.json({ error: errMsg ?? `Provider returned ${statusCode}`, statusCode }, statusCode as 400)
  }

  // ── Parse token usage ─────────────────────────────────────────────────────
  // Per-provider usage shapes live in lib/replay-providers.ts (OpenAI-compat
  // `usage`, Anthropic input/output, Gemini usageMetadata incl. thoughts).
  const { promptTokens, completionTokens, totalTokens } = parseReplayUsage(provider, resBody)

  const costResult = calculateCost(provider as Provider, model, { promptTokens, completionTokens })
  const costUsd = costResult?.totalCost ?? null

  // ── Log async (fire-and-forget) ───────────────────────────────────────────
  fireAndForget(
    c,
    logRequestAsync({
      organizationId: orgId,
      projectId: data.project_id,
      apiKeyId: null,
      provider,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      latencyMs,
      statusCode,
      requestBody: replayBody,
      responseBody: resBody,
      errorMessage: null,
      traceId: null,
      spanId: null,
      providerKeyId: providerKey.id,
    }),
  )

  return c.json({
    success: true,
    data: { latencyMs, statusCode, promptTokens, completionTokens, totalTokens, costUsd },
  })
})
