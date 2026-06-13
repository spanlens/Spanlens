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
import { logOpenRouterStream } from './stream-logger.js'
import { assertProviderKey } from './shared/provider-key.js'
import { parseProxyRequestBody, chooseFetchBody } from './shared/request-body.js'
import { runSecurityGate } from './shared/security-gate.js'
import { fetchUpstreamWithTimeout } from './shared/upstream-fetch.js'
import { buildLogBase } from './shared/log-base.js'
import { runLineBufferedStreamPump } from './shared/stream-pump.js'

// OpenRouter is a meta-provider — one API key, one base URL, 100+ models from
// 30+ providers underneath (OpenAI, Anthropic, Mistral, Meta, DeepSeek,
// Qwen, Cohere, Perplexity, ...). The wire protocol is OpenAI-compatible
// end-to-end, so the same parser + stream logger work unchanged. The only
// two OpenRouter-specific bits live in this file:
//
//   1. Model names carry a `<provider>/<model>` prefix
//      (e.g. `anthropic/claude-3.5-sonnet`, `meta-llama/llama-3.1-70b-instruct`).
//      For our local price lookup we strip the leading segment so the
//      `model_prices` row keyed on the bare model name still matches.
//
//   2. OpenRouter optionally reports the actual billed cost on the response
//      under `usage.cost` (USD, after their margin / discount). When present
//      we trust that number over our own lookup — it's authoritative and
//      already includes any per-customer discount we don't see.
//
// Why not seed every model price: OpenRouter ships hundreds of models that
// rotate weekly. Maintaining a parallel price table would drift; we lean on
// (a) our existing seeds for any model that's also reachable directly and
// (b) OpenRouter's own cost field for the rest. When neither is available
// `cost_usd` lands NULL, mirroring how the proxy already handles unknown
// models (gotcha #2).
const OPENROUTER_BASE = (
  process.env['OPENROUTER_API_BASE'] ?? 'https://openrouter.ai/api'
).replace(/\/v1\/?$/, '')

/** Strip the leading `vendor/` prefix from a model id (no-op when absent). */
function stripVendorPrefix(modelId: string): string {
  const idx = modelId.indexOf('/')
  return idx === -1 ? modelId : modelId.slice(idx + 1)
}

export const openrouterProxy = new Hono<ApiKeyContext>()

openrouterProxy.use('*', authApiKey)
openrouterProxy.use('*', requireFullScope)
openrouterProxy.use('*', proxyRateLimit)
openrouterProxy.use('*', enforceQuota)

openrouterProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()
  const organizationId = c.get('organizationId')
  const projectId = c.get('projectId') as string
  const apiKeyId = c.get('apiKeyId')

  const providerKey = await assertProviderKey(apiKeyId, 'openrouter')
  const parsed = await parseProxyRequestBody(c)
  const requestFlags = await runSecurityGate(parsed.reqBodyJson, projectId)

  const upstreamUrl = `${OPENROUTER_BASE}${c.req.path.replace(/^\/proxy\/openrouter/, '')}`
  // OpenRouter recommends sending `HTTP-Referer` and `X-Title` so the dashboard
  // attribution shows which integration made the call; pass them through if
  // the customer set them, otherwise OpenRouter falls back to its defaults.
  // Their auth header is identical to OpenAI (`Authorization: Bearer ...`).
  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    Authorization: `Bearer ${providerKey.plaintext}`,
    'Content-Type': 'application/json',
  })

  const { upstreamRes, latencyMs, proxyOverheadMs } = await fetchUpstreamWithTimeout({
    url: upstreamUrl,
    method: c.req.method,
    headers,
    body: chooseFetchBody(c, parsed, false),
    provider: 'openrouter',
    handlerStartMs,
  })

  const logBase = await buildLogBase({
    c, provider: 'openrouter',
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
      c, upstreamRes, handlerStartMs, provider: 'openrouter',
      onComplete: (lines, truncated) =>
        logOpenRouterStream(lines, { ...logBase, model }, { truncated }),
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
  // OpenRouter reports actual billed USD on `usage.cost` for some models;
  // capture it before the parser collapses the usage shape so we can prefer
  // it over our local price lookup below.
  let openrouterReportedCost: number | null = null

  if (upstreamRes.ok && resBodyJson) {
    try {
      const bodyAsRecord = resBodyJson as Record<string, unknown>
      const usage = bodyAsRecord['usage'] as Record<string, unknown> | undefined
      const rawCost = usage?.['cost']
      if (typeof rawCost === 'number' && Number.isFinite(rawCost)) {
        openrouterReportedCost = rawCost
      }
      const p = parseOpenAIResponse(bodyAsRecord)
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

  // Cost preference order:
  //   1. OpenRouter's own usage.cost field — authoritative, includes any
  //      per-customer discount / margin we don't see.
  //   2. Our local calculator against the model id with the vendor prefix
  //      stripped (`anthropic/claude-3-5-sonnet` → `claude-3-5-sonnet`).
  //   3. NULL — unknown model, cost not surfaced by upstream.
  let finalCostUsd: number | null = null
  if (openrouterReportedCost !== null) {
    finalCostUsd = openrouterReportedCost
  } else {
    const lookup = calculateCost('openrouter', stripVendorPrefix(resolvedModel), {
      promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens, serviceTier,
    })
    finalCostUsd = lookup?.totalCost ?? null
  }

  fireAndForget(c, logRequestAsync({
    ...logBase,
    model: resolvedModel,
    promptTokens, completionTokens, totalTokens,
    cacheReadTokens, cacheWriteTokens,
    serviceTier: serviceTier ?? null,
    costUsd: finalCostUsd,
    responseBody: resBodyJson,
    errorMessage: upstreamRes.ok ? null : resBodyText.slice(0, 1000),
  }))

  return new Response(resBodyText, { status: upstreamRes.status, headers: downstreamHeaders })
})
