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

// Groq Cloud exposes an OpenAI-compatible surface at `/openai/v1` — the
// request shape, SSE chunk format, and `usage` field all match OpenAI, so
// the OpenAI parser, stream logger, and cost path apply unchanged. Only the
// upstream host + provider tag differ.
//
// Groq honours `stream_options.include_usage` (like OpenAI), so we inject it
// on streaming calls to guarantee a final usage chunk — without it a streamed
// Groq call would log 0 tokens / null cost.
//
// The default host bundles the `/openai` path segment so the incoming
// `/proxy/groq/v1/chat/completions` maps to
// `https://api.groq.com/openai/v1/chat/completions`. The trailing-/v1 strip
// guards against an operator setting GROQ_API_BASE with a redundant /v1.
const GROQ_BASE = (
  process.env['GROQ_API_BASE'] ?? 'https://api.groq.com/openai'
).replace(/\/v1\/?$/, '')
assertSafeProxyBase('GROQ_API_BASE', GROQ_BASE)

export const groqProxy = new Hono<ApiKeyContext>()

groqProxy.use('*', authApiKey)
groqProxy.use('*', requireFullScope)
groqProxy.use('*', proxyRateLimit)
groqProxy.use('*', enforceQuota)
groqProxy.use('*', customerRateLimit)

groqProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()
  const organizationId = c.get('organizationId')
  // requireFullScope rejects 'public' keys and the DB CHECK constraint forces
  // 'full' keys to carry a project_id, so this narrowing is safe.
  const projectId = c.get('projectId') as string
  const apiKeyId = c.get('apiKeyId')

  const [providerKey, parsed] = await Promise.all([
    assertProviderKey(apiKeyId, 'groq'),
    parseProxyRequestBody(c, { injectOpenAIStreamOptions: true }),
  ])
  const requestFlags = await runSecurityGate(parsed.reqBodyJson, projectId)

  const upstreamUrl = `${GROQ_BASE}${c.req.path.replace(/^\/proxy\/groq/, '')}`
  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    Authorization: `Bearer ${providerKey.plaintext}`,
    'Content-Type': 'application/json',
  })

  const { upstreamRes, latencyMs, proxyOverheadMs } = await fetchUpstreamWithTimeout({
    url: upstreamUrl,
    method: c.req.method,
    headers,
    body: chooseFetchBody(c, parsed, true),
    provider: 'groq',
    handlerStartMs,
  })

  const logBase = buildLogBase({
    c, provider: 'groq',
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
      c, upstreamRes, handlerStartMs, provider: 'groq',
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

  const cost = calculateCost('groq', resolvedModel, {
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
