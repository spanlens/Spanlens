import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { getDecryptedProviderKeyById, getDecryptedProviderKey } from '../proxy/utils.js'
import { calculateCost } from '../lib/cost.js'
import { logRequestAsync } from '../lib/logger.js'
import { fireAndForget } from '../lib/wait-until.js'

export const requestsRouter = new Hono<JwtContext>()

requestsRouter.use('*', authJwt)

// GET /api/v1/requests — list requests with optional filters + pagination
// Query params: projectId, provider, model, status, from, to, page, limit
requestsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId')
  const provider   = c.req.query('provider')
  const model      = c.req.query('model')
  const from       = c.req.query('from')     // ISO date string
  const to         = c.req.query('to')
  const page       = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit      = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)))
  const offset     = (page - 1) * limit

  // Optional new filter: provider_key_id ("show only requests that used this key")
  const providerKeyId = c.req.query('providerKeyId')
  const status     = c.req.query('status')   // 'ok' | '4xx' | '5xx'
  const sortByRaw  = c.req.query('sortBy')   // 'latency_ms' | 'cost_usd' | 'total_tokens' | 'created_at'
  const sortDirRaw = c.req.query('sortDir')  // 'asc' | 'desc'

  const validSortCols = ['created_at', 'latency_ms', 'cost_usd', 'total_tokens'] as const
  type SortCol = (typeof validSortCols)[number]
  const sortCol: SortCol = validSortCols.includes(sortByRaw as SortCol) ? (sortByRaw as SortCol) : 'created_at'
  const ascending = sortDirRaw === 'asc'

  // Embed the provider_key row's `name` so the dashboard can render
  // "openai · prod-key-2" without a second round-trip.
  let query = supabaseAdmin
    .from('requests')
    .select(
      'id, project_id, provider, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, status_code, error_message, trace_id, span_id, provider_key_id, provider_keys ( name ), created_at',
      { count: 'exact' },
    )
    .eq('organization_id', orgId)
    .order(sortCol, { ascending, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (projectId)     query = query.eq('project_id', projectId)
  if (provider)      query = query.eq('provider', provider)
  if (model)         query = query.ilike('model', `%${model}%`)
  if (providerKeyId) query = query.eq('provider_key_id', providerKeyId)
  if (from)          query = query.gte('created_at', from)
  if (to)            query = query.lte('created_at', to)
  if (status === 'ok')   query = query.lt('status_code', 400)
  else if (status === '4xx') query = query.gte('status_code', 400).lt('status_code', 500)
  else if (status === '5xx') query = query.gte('status_code', 500)

  const { data, error, count } = await query
  if (error) return c.json({ error: 'Failed to fetch requests' }, 500)

  // Flatten the embedded provider_keys.name onto the row for simpler client typing.
  // supabase-js infers FK relations as arrays in its return type, so cast
  // through `unknown` and pick name defensively (covers both shapes).
  type EmbeddedKey = { name: string | null } | Array<{ name: string | null }> | null | undefined
  type Row = { provider_keys?: EmbeddedKey; [k: string]: unknown }
  const flat = ((data as unknown as Row[]) ?? []).map((row) => {
    const nested = row.provider_keys
    const keyName = Array.isArray(nested) ? nested[0]?.name ?? null : nested?.name ?? null
    return {
      ...row,
      provider_key_name: keyName,
      provider_keys: undefined, // strip the nested object
    }
  })

  return c.json({
    success: true,
    data: flat,
    meta: { total: count ?? 0, page, limit },
  })
})

// GET /api/v1/requests/:id — get full request detail including bodies
requestsRouter.get('/:id', async (c) => {
  const requestId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('requests')
    .select('*, provider_keys ( name )')
    .eq('id', requestId)
    .eq('organization_id', orgId)
    .single()

  if (error || !data) return c.json({ error: 'Request not found' }, 404)

  type EmbeddedKeyDetail =
    | { name: string | null }
    | Array<{ name: string | null }>
    | null
    | undefined
  const nested = (data as unknown as { provider_keys?: EmbeddedKeyDetail }).provider_keys
  const keyObj = Array.isArray(nested) ? nested[0] ?? null : nested ?? null
  const flat = {
    ...data,
    provider_key_name: keyObj?.name ?? null,
    provider_keys: undefined,
  }

  return c.json({ success: true, data: flat })
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
requestsRouter.post('/:id/replay', async (c) => {
  const requestId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { model?: unknown } = {}
  try {
    body = (await c.req.json()) as { model?: unknown }
  } catch {
    body = {}
  }
  const overrideModel = typeof body.model === 'string' ? body.model : undefined

  const { data, error } = await supabaseAdmin
    .from('requests')
    .select('id, organization_id, provider, model, request_body')
    .eq('id', requestId)
    .eq('organization_id', orgId)
    .single()

  if (error || !data) return c.json({ error: 'Request not found' }, 404)

  // Build the replay payload — same body, optionally swap the model field.
  const original = (data.request_body ?? {}) as Record<string, unknown>
  const replayBody = overrideModel
    ? { ...original, model: overrideModel }
    : original

  // Strip truncation markers (these came from logger.serializeBody when the
  // original body exceeded 10KB). Replays of truncated bodies are best-effort.
  if (
    typeof replayBody === 'object' &&
    replayBody !== null &&
    '_truncated' in replayBody
  ) {
    return c.json(
      {
        error:
          'Original request body was truncated and cannot be replayed exactly. Re-send manually from your application.',
      },
      422,
    )
  }

  // Build provider-specific proxy path for the curl snippet.
  // Gemini encodes the model in the URL: /v1beta/models/{model}:generateContent
  const model = (overrideModel ?? data.model ?? '') as string
  let proxyPath: string
  if (data.provider === 'openai') {
    proxyPath = '/proxy/openai/v1/chat/completions'
  } else if (data.provider === 'anthropic') {
    proxyPath = '/proxy/anthropic/v1/messages'
  } else if (data.provider === 'gemini') {
    const geminiModel = model.startsWith('models/') ? model : `models/${model}`
    proxyPath = `/proxy/gemini/v1beta/${geminiModel}:generateContent`
  } else {
    proxyPath = `/proxy/${data.provider as string}`
  }

  return c.json({
    success: true,
    data: {
      provider: data.provider as string,
      replayBody,
      proxyPath,
    },
  })
})

// POST /api/v1/requests/:id/replay/run
// Execute a replay directly from the dashboard (JWT auth).
// Calls the upstream provider API (non-streaming), logs the result, and
// returns latency / token counts / cost so the UI can show them inline.
requestsRouter.post('/:id/replay/run', async (c) => {
  const requestId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { model?: unknown } = {}
  try { body = (await c.req.json()) as { model?: unknown } } catch { body = {} }
  const overrideModel = typeof body.model === 'string' ? body.model : undefined

  // ── Fetch original request ────────────────────────────────────────────────
  const { data, error } = await supabaseAdmin
    .from('requests')
    .select('id, organization_id, project_id, provider, model, request_body, provider_key_id')
    .eq('id', requestId)
    .eq('organization_id', orgId)
    .single()

  if (error || !data) return c.json({ error: 'Request not found' }, 404)

  const original = (data.request_body ?? {}) as Record<string, unknown>
  if ('_truncated' in original) {
    return c.json(
      { error: 'Original request body was truncated and cannot be replayed exactly.' },
      422,
    )
  }

  // ── Decrypt provider key ──────────────────────────────────────────────────
  const providerKey = data.provider_key_id
    ? await getDecryptedProviderKeyById(data.provider_key_id as string, orgId)
    : await getDecryptedProviderKey(orgId, data.project_id as string, data.provider as string)

  if (!providerKey) return c.json({ error: 'Provider key not found or inactive' }, 400)

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
  const provider = data.provider as string
  let upstreamUrl: string
  let upstreamHeaders: Record<string, string>

  if (provider === 'openai') {
    upstreamUrl = 'https://api.openai.com/v1/chat/completions'
    upstreamHeaders = { Authorization: `Bearer ${providerKey.plaintext}`, 'Content-Type': 'application/json' }
  } else if (provider === 'anthropic') {
    upstreamUrl = 'https://api.anthropic.com/v1/messages'
    upstreamHeaders = {
      'x-api-key': providerKey.plaintext,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    }
  } else if (provider === 'gemini') {
    const geminiModel = model.startsWith('models/') ? model : `models/${model}`
    upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/${geminiModel}:generateContent?key=${providerKey.plaintext}`
    upstreamHeaders = { 'Content-Type': 'application/json' }
  } else {
    return c.json({ error: `Unsupported provider for run: ${provider}` }, 400)
  }

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
    return c.json({ error: `Failed to reach upstream: ${String(fetchErr)}` }, 502)
  }

  const latencyMs = Date.now() - startMs
  const statusCode = upstreamRes.status
  const resBody = (await upstreamRes.json().catch(() => ({}))) as Record<string, unknown>

  if (!upstreamRes.ok) {
    const errMsg = (resBody.error as Record<string, unknown> | undefined)?.message as string | undefined
    return c.json({ error: errMsg ?? `Provider returned ${statusCode}`, statusCode }, statusCode as 400)
  }

  // ── Parse token usage ─────────────────────────────────────────────────────
  let promptTokens = 0, completionTokens = 0, totalTokens = 0

  if (provider === 'openai') {
    const u = resBody.usage as Record<string, number> | undefined
    promptTokens    = u?.prompt_tokens    ?? 0
    completionTokens = u?.completion_tokens ?? 0
    totalTokens     = u?.total_tokens     ?? 0
  } else if (provider === 'anthropic') {
    const u = resBody.usage as Record<string, number> | undefined
    promptTokens    = u?.input_tokens  ?? 0
    completionTokens = u?.output_tokens ?? 0
    totalTokens     = promptTokens + completionTokens
  } else if (provider === 'gemini') {
    const u = resBody.usageMetadata as Record<string, number> | undefined
    promptTokens    = u?.promptTokenCount     ?? 0
    completionTokens = u?.candidatesTokenCount ?? 0
    totalTokens     = u?.totalTokenCount      ?? promptTokens + completionTokens
  }

  const costResult = calculateCost(provider as 'openai', model, { promptTokens, completionTokens })
  const costUsd = costResult?.totalCost ?? null

  // ── Log async (fire-and-forget) ───────────────────────────────────────────
  fireAndForget(
    c,
    logRequestAsync({
      organizationId: orgId,
      projectId: data.project_id as string,
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
