import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
import { enforceQuota } from '../middleware/quota.js'
import { proxyRateLimit } from '../middleware/rateLimit.js'
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

// Mistral's public API. Their chat completion endpoint is OpenAI-compatible
// down to the request and response shape, the SSE chunk format, and the
// usage field — so the OpenAI parser, OpenAI stream logger, and OpenAI cost
// calculator path all apply unchanged. Only the upstream host + provider tag
// for log rows differ.
//
// The official EU-data-residency endpoint is `api.mistral.ai`; an alternate
// `codestral.mistral.ai` exists for the code-completion model family but
// is API-compatible — operators who need that path can override via env.
const MISTRAL_BASE = (
  process.env['MISTRAL_API_BASE'] ?? 'https://api.mistral.ai'
).replace(/\/v1\/?$/, '')

export const mistralProxy = new Hono<ApiKeyContext>()

mistralProxy.use('*', authApiKey)
mistralProxy.use('*', requireFullScope)
mistralProxy.use('*', proxyRateLimit)
mistralProxy.use('*', enforceQuota)

mistralProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()
  const organizationId = c.get('organizationId')
  // requireFullScope rejects 'public' keys and the DB CHECK constraint forces
  // 'full' keys to carry a project_id, so this narrowing is safe.
  const projectId = c.get('projectId') as string
  const apiKeyId = c.get('apiKeyId')

  const providerKey = await assertProviderKey(apiKeyId, 'mistral')
  // stream_options.include_usage is OpenAI-only — Mistral always emits usage
  // in the final SSE chunk regardless of any flag, so no injection needed.
  const parsed = await parseProxyRequestBody(c)
  const requestFlags = await runSecurityGate(parsed.reqBodyJson, projectId)

  const upstreamUrl = `${MISTRAL_BASE}${c.req.path.replace(/^\/proxy\/mistral/, '')}`
  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    Authorization: `Bearer ${providerKey.plaintext}`,
    'Content-Type': 'application/json',
  })

  const { upstreamRes, latencyMs, proxyOverheadMs } = await fetchUpstreamWithTimeout({
    url: upstreamUrl,
    method: c.req.method,
    headers,
    body: chooseFetchBody(c, parsed, false),
    provider: 'mistral',
    handlerStartMs,
  })

  const logBase = await buildLogBase({
    c, provider: 'mistral',
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
      c, upstreamRes, handlerStartMs, provider: 'mistral',
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

  const cost = calculateCost('mistral', resolvedModel, {
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
