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

// Cohere exposes an OpenAI-compatibility layer at `/compatibility/v1` that
// translates to its native /v2/chat. Request shape, SSE chunk format, and the
// `usage` object are OpenAI-compatible, so the OpenAI parser, stream logger,
// and cost path apply unchanged. Only the upstream host + provider tag differ.
//
// Unlike OpenAI/Groq/DeepSeek/xAI we deliberately do NOT inject
// `stream_options.include_usage`: Cohere's compat layer rejects/ignores a set
// of OpenAI-only params (store, metadata, logit_bias, n, service_tier,
// parallel_tool_calls, ...), and stream_options support on the compat surface
// is not documented. Injecting an unrecognized param risks a 400. As a result
// a streamed Cohere call may not carry a final usage chunk — those rows log
// cost_usd = null (same graceful behaviour as any unknown model, gotcha #2).
// Non-streaming Cohere calls always return usage and are costed normally. Model
// IDs must be Cohere IDs (command-a-03-2025, command-r-08-2024, ...), not gpt-*.
const COHERE_BASE = (
  process.env['COHERE_API_BASE'] ?? 'https://api.cohere.ai/compatibility'
).replace(/\/v1\/?$/, '')
assertSafeProxyBase('COHERE_API_BASE', COHERE_BASE)

export const cohereProxy = new Hono<ApiKeyContext>()

cohereProxy.use('*', authApiKey)
cohereProxy.use('*', requireFullScope)
cohereProxy.use('*', proxyRateLimit)
cohereProxy.use('*', enforceQuota)
cohereProxy.use('*', customerRateLimit)

cohereProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()
  const organizationId = c.get('organizationId')
  const projectId = c.get('projectId') as string
  const apiKeyId = c.get('apiKeyId')

  const [providerKey, parsed] = await Promise.all([
    assertProviderKey(apiKeyId, 'cohere'),
    parseProxyRequestBody(c),
  ])
  const requestFlags = await runSecurityGate(parsed.reqBodyJson, projectId)

  const upstreamUrl = `${COHERE_BASE}${c.req.path.replace(/^\/proxy\/cohere/, '')}`
  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    Authorization: `Bearer ${providerKey.plaintext}`,
    'Content-Type': 'application/json',
  })

  const { upstreamRes, latencyMs, proxyOverheadMs } = await fetchUpstreamWithTimeout({
    url: upstreamUrl,
    method: c.req.method,
    headers,
    body: chooseFetchBody(c, parsed, false),
    provider: 'cohere',
    handlerStartMs,
  })

  const logBase = buildLogBase({
    c, provider: 'cohere',
    organizationId, projectId, apiKeyId,
    providerKey,
    reqBodyJson: parsed.reqBodyJson,
    requestFlags,
    latencyMs, proxyOverheadMs,
    statusCode: upstreamRes.status,
  })

  const model = (parsed.reqBodyJson?.['model'] as string | undefined) ?? ''

  // ── Streaming path ────────────────────────────────────────────────────────
  if (parsed.isStreaming && upstreamRes.body) {
    return runLineBufferedStreamPump({
      c, upstreamRes, handlerStartMs, provider: 'cohere',
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

  const cost = calculateCost('cohere', resolvedModel, {
    promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens, serviceTier,
  })

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
