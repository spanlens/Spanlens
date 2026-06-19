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
import { ApiError } from '../lib/errors.js'
import { logError } from '../lib/structured-logger.js'
import { assertProviderKey } from './shared/provider-key.js'
import { parseProxyRequestBody, chooseFetchBody } from './shared/request-body.js'
import { runSecurityGate } from './shared/security-gate.js'
import { fetchUpstreamWithTimeout } from './shared/upstream-fetch.js'
import { buildLogBase } from './shared/log-base.js'
import { runLineBufferedStreamPump } from './shared/stream-pump.js'

// Azure OpenAI v1 endpoint (Microsoft, Aug 2025+). Drop-in compatible with
// OpenAI request/response shape — no api-version query, no per-deployment
// URL fragments. Customer's resource origin lives on
// provider_keys.provider_metadata.resource_url.
//
// Differences vs. /proxy/openai:
//   - Base URL is per-key (Azure resource), not a constant
//   - Auth header: api-key (not Authorization: Bearer)
//   - Response includes Azure-only fields (prompt_filter_results,
//     content_filter_results, system_fingerprint) — OpenAI parser ignores
//     unknown fields, so passthrough works
export const azureProxy = new Hono<ApiKeyContext>()

azureProxy.use('*', authApiKey)
azureProxy.use('*', requireFullScope)
azureProxy.use('*', proxyRateLimit)
azureProxy.use('*', enforceQuota)
azureProxy.use('*', customerRateLimit)

azureProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()
  const organizationId = c.get('organizationId')
  const projectId = c.get('projectId') as string
  const apiKeyId = c.get('apiKeyId')

  // Provider-key lookup and body parse are independent — run concurrently.
  // The resource_url guard reads providerKey.metadata, so it runs after.
  const [providerKey, parsed] = await Promise.all([
    assertProviderKey(apiKeyId, 'azure'),
    parseProxyRequestBody(c, { injectOpenAIStreamOptions: true }),
  ])

  // resource_url is enforced NOT NULL at the DB layer for 'azure' rows
  // (provider_keys_azure_requires_resource_url CHECK constraint).
  // Defensive empty-string fallback only triggers if a future migration
  // removes the constraint — surface a clear 500 rather than build a
  // malformed upstream URL.
  const resourceUrl = (providerKey.metadata['resource_url'] as string | undefined) ?? ''
  if (resourceUrl.length === 0) {
    logError('UNCATEGORIZED', { provider: 'azure', providerKeyId: providerKey.id, kind: 'missing_resource_url' })
    throw new ApiError('INTERNAL_ERROR', 'Azure provider key is missing resource_url — re-register it')
  }

  const requestFlags = await runSecurityGate(parsed.reqBodyJson, projectId)

  const upstreamUrl = `${resourceUrl}/openai/v1${c.req.path.replace(/^\/proxy\/azure/, '')}`
  // Azure uses `api-key` (not Authorization Bearer). Strip authorization
  // explicitly in case some client lib retransmits one.
  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    'api-key': providerKey.plaintext,
    'Content-Type': 'application/json',
  })
  headers.delete('authorization')

  const { upstreamRes, latencyMs, proxyOverheadMs } = await fetchUpstreamWithTimeout({
    url: upstreamUrl,
    method: c.req.method,
    headers,
    body: chooseFetchBody(c, parsed, true),
    provider: 'azure',
    handlerStartMs,
  })

  const logBase = buildLogBase({
    c, provider: 'azure',
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
    // Azure SSE chunk shape is OpenAI-compatible — same parser works. The
    // 'azure' provider tag on logBase is what flows into ClickHouse.
    return runLineBufferedStreamPump({
      c, upstreamRes, handlerStartMs, provider: 'azure',
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

  // Azure exposes OpenAI models at OpenAI prices — reuse the OpenAI price
  // table rather than maintaining a parallel one.
  const cost = calculateCost('openai', resolvedModel, {
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
