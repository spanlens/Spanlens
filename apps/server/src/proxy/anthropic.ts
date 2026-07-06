import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
import { enforceQuota } from '../middleware/quota.js'
import { proxyRateLimit } from '../middleware/rateLimit.js'
import { customerRateLimit } from '../middleware/customerRateLimit.js'
import { calculateCost } from '../lib/cost.js'
import { logRequestAsync } from '../lib/logger.js'
import { fireAndForget } from '../lib/wait-until.js'
import { parseAnthropicResponse } from '../parsers/anthropic.js'
import type { ServiceTier } from '../parsers/openai.js'
import { buildUpstreamHeaders, buildDownstreamHeaders } from './utils.js'
import { logAnthropicStream } from './stream-logger.js'
import { assertProviderKey } from './shared/provider-key.js'
import { parseProxyRequestBody, chooseFetchBody } from './shared/request-body.js'
import { runSecurityGate } from './shared/security-gate.js'
import { fetchUpstreamWithTimeout } from './shared/upstream-fetch.js'
import { buildLogBase } from './shared/log-base.js'
import { runLineBufferedStreamPump } from './shared/stream-pump.js'
import {
  PROXY_CACHE_HEADER,
  resolveProxyCache,
  deleteExpiredCacheEntry,
  storeCachedProxyResponse,
} from '../lib/proxy-cache.js'

const ANTHROPIC_BASE = 'https://api.anthropic.com'

export const anthropicProxy = new Hono<ApiKeyContext>()

anthropicProxy.use('*', authApiKey)
anthropicProxy.use('*', requireFullScope)
anthropicProxy.use('*', proxyRateLimit)
anthropicProxy.use('*', enforceQuota)
anthropicProxy.use('*', customerRateLimit)

anthropicProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()
  const organizationId = c.get('organizationId')
  const projectId = c.get('projectId') as string
  const apiKeyId = c.get('apiKeyId')

  // Provider-key lookup and body parse are independent — run concurrently.
  const [providerKey, parsed] = await Promise.all([
    assertProviderKey(apiKeyId, 'anthropic'),
    // Anthropic stream usage is in message_delta — no stream_options injection needed.
    parseProxyRequestBody(c),
  ])
  const requestFlags = await runSecurityGate(parsed.reqBodyJson, projectId)

  // ── Opt-in response cache (x-spanlens-cache header) ────────────────────────
  // Same wiring as proxy/openai.ts — see lib/proxy-cache.ts for semantics.
  const cache = await resolveProxyCache({
    cacheHeader: c.req.header(PROXY_CACHE_HEADER),
    isStreaming: parsed.isStreaming,
    apiKeyId,
    provider: 'anthropic',
    path: c.req.path,
    rawBody: parsed.reqBodyText,
  })
  if (cache.expiredKeyHash) fireAndForget(c, deleteExpiredCacheEntry(cache.expiredKeyHash))
  if (cache.state.mode === 'hit') {
    const hit = cache.state.entry
    const latencyMs = Date.now() - handlerStartMs
    const hitLogBase = buildLogBase({
      c, provider: 'anthropic',
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

  const upstreamUrl = `${ANTHROPIC_BASE}${c.req.path.replace(/^\/proxy\/anthropic/, '')}`
  // Anthropic uses `x-api-key` (NOT Authorization Bearer) + anthropic-version.
  // Authorization is deleted explicitly in case a client lib retransmits one.
  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    'x-api-key': providerKey.plaintext,
    'anthropic-version': c.req.header('anthropic-version') ?? '2023-06-01',
    'Content-Type': 'application/json',
  })
  headers.delete('authorization')

  const { upstreamRes, latencyMs, proxyOverheadMs } = await fetchUpstreamWithTimeout({
    url: upstreamUrl,
    method: c.req.method,
    headers,
    body: chooseFetchBody(c, parsed, false),
    provider: 'anthropic',
    handlerStartMs,
  })

  const logBase = buildLogBase({
    c, provider: 'anthropic',
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
      c, upstreamRes, handlerStartMs, provider: 'anthropic',
      onComplete: (lines, truncated) =>
        logAnthropicStream(lines, { ...logBase, model }, { truncated }),
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
      const p = parseAnthropicResponse(resBodyJson as Record<string, unknown>)
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

  const cost = calculateCost('anthropic', resolvedModel, {
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
        provider: 'anthropic',
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
