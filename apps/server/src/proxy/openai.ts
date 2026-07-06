import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
import { enforceQuota } from '../middleware/quota.js'
import { proxyRateLimit } from '../middleware/rateLimit.js'
import { customerRateLimit } from '../middleware/customerRateLimit.js'
import { calculateCost } from '../lib/cost.js'
import { logRequestAsync } from '../lib/logger.js'
import { fireAndForget } from '../lib/wait-until.js'
import { parseOpenAIResponse, type ServiceTier } from '../parsers/openai.js'
import { buildUpstreamHeaders, buildDownstreamHeaders } from './utils.js'
import { logOpenAIStream } from './stream-logger.js'
import { assertProviderKey } from './shared/provider-key.js'
import { parseProxyRequestBody, chooseFetchBody } from './shared/request-body.js'
import { runSecurityGate } from './shared/security-gate.js'
import { fetchUpstreamWithTimeout } from './shared/upstream-fetch.js'
import { buildLogBase } from './shared/log-base.js'
import { runLineBufferedStreamPump } from './shared/stream-pump.js'
import { assertSafeProxyBase } from './shared/validate-base.js'
import {
  PROXY_CACHE_HEADER,
  resolveProxyCache,
  deleteExpiredCacheEntry,
  storeCachedProxyResponse,
} from '../lib/proxy-cache.js'

// Overridable so E2E (apps/web/__e2e__/smoke.spec.ts via docker-compose
// dev mock-openai) can point this at http://localhost:4000 without hitting
// real OpenAI credits or rate limits. Production leaves OPENAI_API_BASE
// unset and the default api.openai.com applies. Strip a trailing /v1 if
// the operator includes it — OpenAI's path already starts with /v1, and
// duplicating it produces /v1/v1/chat/completions which 404s.
const OPENAI_BASE = (
  process.env['OPENAI_API_BASE'] ?? 'https://api.openai.com'
).replace(/\/v1\/?$/, '')
assertSafeProxyBase('OPENAI_API_BASE', OPENAI_BASE)

export const openaiProxy = new Hono<ApiKeyContext>()

openaiProxy.use('*', authApiKey)
openaiProxy.use('*', requireFullScope)
openaiProxy.use('*', proxyRateLimit)
openaiProxy.use('*', enforceQuota)
openaiProxy.use('*', customerRateLimit)

openaiProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()
  const organizationId = c.get('organizationId')
  // requireFullScope rejects 'public' keys and the DB CHECK constraint forces
  // 'full' keys to carry a project_id, so this narrowing is safe.
  const projectId = c.get('projectId') as string
  const apiKeyId = c.get('apiKeyId')

  // The provider-key lookup (DB + decrypt) and the body read/parse are
  // independent — run them concurrently to shave one round-trip off the
  // pre-fetch critical path. runSecurityGate depends on parsed, so it stays after.
  const [providerKey, parsed] = await Promise.all([
    assertProviderKey(apiKeyId, 'openai'),
    parseProxyRequestBody(c, { injectOpenAIStreamOptions: true }),
  ])
  const requestFlags = await runSecurityGate(parsed.reqBodyJson, projectId)

  // ── Opt-in response cache (x-spanlens-cache header) ────────────────────────
  // Exact-match on (api key, provider, path, raw body). HIT skips upstream
  // entirely; the row still logs with the cached tokens/model, cost_usd 0,
  // and cache_hit 1. See lib/proxy-cache.ts.
  const cache = await resolveProxyCache({
    cacheHeader: c.req.header(PROXY_CACHE_HEADER),
    isStreaming: parsed.isStreaming,
    apiKeyId,
    provider: 'openai',
    path: c.req.path,
    rawBody: parsed.reqBodyText,
  })
  if (cache.expiredKeyHash) fireAndForget(c, deleteExpiredCacheEntry(cache.expiredKeyHash))
  if (cache.state.mode === 'hit') {
    const hit = cache.state.entry
    const latencyMs = Date.now() - handlerStartMs
    const hitLogBase = buildLogBase({
      c, provider: 'openai',
      organizationId, projectId, apiKeyId,
      providerKey,
      reqBodyJson: parsed.reqBodyJson,
      requestFlags,
      latencyMs, proxyOverheadMs: latencyMs,
      statusCode: hit.responseStatus,
    })
    let cachedBodyJson: unknown = null
    try { cachedBodyJson = JSON.parse(hit.responseBody) } catch { /* stored body is JSON by construction */ }
    fireAndForget(c, logRequestAsync({
      ...hitLogBase,
      model: hit.model,
      promptTokens: hit.usage.prompt_tokens,
      completionTokens: hit.usage.completion_tokens,
      totalTokens: hit.usage.total_tokens,
      cacheReadTokens: hit.usage.cache_read_tokens,
      cacheWriteTokens: hit.usage.cache_write_tokens,
      serviceTier: null,
      costUsd: 0,
      cacheHit: true,
      responseBody: cachedBodyJson,
      errorMessage: null,
    }))
    return new Response(hit.responseBody, {
      status: hit.responseStatus,
      headers: { 'content-type': 'application/json', [PROXY_CACHE_HEADER]: 'hit' },
    })
  }

  const upstreamUrl = `${OPENAI_BASE}${c.req.path.replace(/^\/proxy\/openai/, '')}`
  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    Authorization: `Bearer ${providerKey.plaintext}`,
    'Content-Type': 'application/json',
  })

  const { upstreamRes, latencyMs, proxyOverheadMs } = await fetchUpstreamWithTimeout({
    url: upstreamUrl,
    method: c.req.method,
    headers,
    body: chooseFetchBody(c, parsed, true),
    provider: 'openai',
    handlerStartMs,
  })

  const logBase = buildLogBase({
    c, provider: 'openai',
    organizationId, projectId, apiKeyId,
    providerKey,
    reqBodyJson: parsed.reqBodyJson,
    requestFlags,
    latencyMs, proxyOverheadMs,
    statusCode: upstreamRes.status,
  })

  const model = (parsed.reqBodyJson?.model as string | undefined) ?? ''

  // ── Streaming path ────────────────────────────────────────────────────────
  if (parsed.isStreaming && upstreamRes.body) {
    // Caching was requested but streaming responses are never cached.
    if (cache.state.mode === 'bypass') c.header(PROXY_CACHE_HEADER, 'bypass')
    return runLineBufferedStreamPump({
      c, upstreamRes, handlerStartMs, provider: 'openai',
      onComplete: (lines, truncated) =>
        logOpenAIStream(lines, { ...logBase, model }, { truncated }),
    })
  }

  // ── Non-streaming path ────────────────────────────────────────────────────
  const downstreamHeaders = buildDownstreamHeaders(upstreamRes.headers)
  const resBodyText = await upstreamRes.text()
  let resBodyJson: unknown = null
  try { resBodyJson = JSON.parse(resBodyText) } catch { /* non-JSON response */ }

  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let resolvedModel = model
  let serviceTier: ServiceTier | undefined

  if (upstreamRes.ok && resBodyJson) {
    try {
      const p = parseOpenAIResponse(resBodyJson as Record<string, unknown>)
      if (p) {
        resolvedModel = p.model || model
        promptTokens = p.promptTokens
        completionTokens = p.completionTokens
        totalTokens = p.totalTokens
        cacheReadTokens = p.cacheReadTokens ?? 0
        cacheWriteTokens = p.cacheWriteTokens ?? 0
        serviceTier = p.serviceTier
      }
    } catch { /* ignore */ }
  }

  const cost = calculateCost('openai', resolvedModel, {
    promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens, serviceTier,
  })

  // Cache MISS: store the successful JSON response off the response-critical
  // path (fireAndForget — gotcha #8). storeCachedProxyResponse re-checks the
  // 200 + size guards internally.
  if (cache.state.mode === 'miss') {
    downstreamHeaders.set(PROXY_CACHE_HEADER, 'miss')
    if (upstreamRes.status === 200 && resBodyJson !== null) {
      fireAndForget(c, storeCachedProxyResponse({
        keyHash: cache.state.keyHash,
        apiKeyId,
        provider: 'openai',
        ttlSeconds: cache.state.ttlSeconds,
        responseStatus: upstreamRes.status,
        responseBody: resBodyText,
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          cache_read_tokens: cacheReadTokens,
          cache_write_tokens: cacheWriteTokens,
        },
        model: resolvedModel,
      }))
    }
  }

  fireAndForget(c, logRequestAsync({
    ...logBase,
    model: resolvedModel,
    promptTokens, completionTokens, totalTokens,
    cacheReadTokens, cacheWriteTokens,
    serviceTier: serviceTier ?? null,
    costUsd: cost?.totalCost ?? null,
    responseBody: resBodyJson,
    errorMessage: upstreamRes.ok ? null : resBodyText.slice(0, 1000),
  }))

  return new Response(resBodyText, { status: upstreamRes.status, headers: downstreamHeaders })
})
