import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
import { enforceQuota } from '../middleware/quota.js'
import { proxyRateLimit } from '../middleware/rateLimit.js'
import { customerRateLimit } from '../middleware/customerRateLimit.js'
import { calculateCost } from '../lib/cost.js'
import { logRequestAsync } from '../lib/logger.js'
import { fireAndForget } from '../lib/wait-until.js'
import { parseGeminiResponse, extractGeminiStreamText } from '../parsers/gemini.js'
import type { ServiceTier } from '../parsers/openai.js'
import { buildUpstreamHeaders, buildDownstreamHeaders } from './utils.js'
import { logWarn } from '../lib/structured-logger.js'
import { assertProviderKey } from './shared/provider-key.js'
import { parseProxyRequestBody, chooseFetchBody } from './shared/request-body.js'
import { runSecurityGate } from './shared/security-gate.js'
import { fetchUpstreamWithTimeout } from './shared/upstream-fetch.js'
import { buildLogBase } from './shared/log-base.js'
import { runChunkAccumulatedStreamPump } from './shared/stream-pump.js'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'

export const geminiProxy = new Hono<ApiKeyContext>()

geminiProxy.use('*', authApiKey)
geminiProxy.use('*', requireFullScope)
geminiProxy.use('*', proxyRateLimit)
geminiProxy.use('*', enforceQuota)
geminiProxy.use('*', customerRateLimit)

geminiProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()
  const organizationId = c.get('organizationId')
  const projectId = c.get('projectId') as string
  const apiKeyId = c.get('apiKeyId')

  const providerKey = await assertProviderKey(apiKeyId, 'gemini')
  // Gemini's body stays untransformed; isStreaming is decided by the URL
  // path (`:streamGenerateContent`), not the body's `stream` flag.
  const parsed = await parseProxyRequestBody(c)

  // Build the upstream URL with our decrypted key in `?key=` (the caller's
  // ?key= is OVERWRITTEN — a customer can't smuggle their own credential).
  const originalPath = c.req.path.replace(/^\/proxy\/gemini/, '')
  const upstreamUrlObj = new URL(`${GEMINI_BASE}${originalPath}`)
  const clientUrl = new URL(c.req.raw.url)
  clientUrl.searchParams.forEach((v, k) => {
    if (k !== 'key') upstreamUrlObj.searchParams.set(k, v)
  })
  upstreamUrlObj.searchParams.set('key', providerKey.plaintext)

  // Gemini doesn't use Authorization. Strip explicitly so any client-supplied
  // bearer never reaches the upstream URL or fetch headers.
  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    'Content-Type': 'application/json',
  })
  headers.delete('authorization')

  const requestFlags = await runSecurityGate(parsed.reqBodyJson, projectId)

  const { upstreamRes, latencyMs, proxyOverheadMs } = await fetchUpstreamWithTimeout({
    url: upstreamUrlObj.toString(),
    method: c.req.method,
    headers,
    body: chooseFetchBody(c, parsed, false),
    provider: 'gemini',
    handlerStartMs,
  })

  // Extract model name from the URL path (e.g.
  // /v1/models/gemini-1.5-pro:streamGenerateContent).
  const modelMatch = /\/models\/([^/:]+)/.exec(originalPath)
  const isStreaming = /:streamGenerateContent/.test(originalPath)

  const logBase = await buildLogBase({
    c, provider: 'gemini',
    organizationId, projectId, apiKeyId,
    providerKey,
    reqBodyJson: parsed.reqBodyJson,
    requestFlags,
    latencyMs, proxyOverheadMs,
    statusCode: upstreamRes.status,
  })

  // ── Streaming path ────────────────────────────────────────────────────────
  // Gemini sends a JSON array (not line-delimited SSE), so the pump
  // accumulates raw chunks and the parser walks the full buffer.
  if (isStreaming && upstreamRes.body) {
    return runChunkAccumulatedStreamPump({
      c, upstreamRes, handlerStartMs, provider: 'gemini',
      onComplete: async (buffer, truncated) => {
        const text = extractGeminiStreamText(buffer.split('\n'))

        // Best-effort: recover usage + model from the last full JSON object
        // in the array. usage may be missing on aborted streams — acceptable.
        let model = modelMatch?.[1] ?? ''
        let promptTokens = 0
        let completionTokens = 0
        let totalTokens = 0
        let serviceTier: ServiceTier | undefined
        try {
          const lastChunkText = buffer.trim().replace(/^\[/, '').replace(/\]$/, '')
          const candidates = lastChunkText.split(/(?<=})\s*,\s*(?=\{)/g)
          const last = candidates[candidates.length - 1]
          if (last) {
            const p = parseGeminiResponse(JSON.parse(last) as Record<string, unknown>)
            if (p) {
              model = p.model || model
              promptTokens = p.promptTokens
              completionTokens = p.completionTokens
              totalTokens = p.totalTokens
              serviceTier = p.serviceTier
            }
          }
        } catch { /* parser drift on aborted streams — acceptable */ }

        // Capture-rate signal: stream produced output bytes but yielded no
        // extractable text means the parser drifted from Gemini's wire
        // format. Surface as warn for log monitoring.
        if (buffer.length > 0 && text.length === 0) {
          logWarn('UNCATEGORIZED', { provider: 'gemini', kind: 'capture_empty', bytes: buffer.length })
        }

        const cost = calculateCost('gemini', model, { promptTokens, completionTokens, serviceTier })
        const responseBody = text ? {
          candidates: [{ content: { parts: [{ text }] } }],
          modelVersion: model,
          usageMetadata: {
            promptTokenCount: promptTokens,
            candidatesTokenCount: completionTokens,
            totalTokenCount: totalTokens,
          },
        } : null

        return logRequestAsync({
          ...logBase,
          model,
          promptTokens, completionTokens, totalTokens,
          serviceTier: serviceTier ?? null,
          costUsd: cost?.totalCost ?? null,
          responseBody,
          truncated,
        })
      },
    })
  }

  // ── Non-streaming path ────────────────────────────────────────────────────
  const resBodyText = await upstreamRes.text()
  let resBodyJson: unknown = null
  try { resBodyJson = JSON.parse(resBodyText) } catch { /* non-JSON response */ }

  let model = modelMatch?.[1] ?? ''
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let serviceTier: ServiceTier | undefined

  if (upstreamRes.ok && resBodyJson) {
    try {
      const p = parseGeminiResponse(resBodyJson as Record<string, unknown>)
      if (p) {
        model = p.model || model
        promptTokens = p.promptTokens
        completionTokens = p.completionTokens
        totalTokens = p.totalTokens
        serviceTier = p.serviceTier
      }
    } catch { /* ignore */ }
  }

  const cost = calculateCost('gemini', model, { promptTokens, completionTokens, serviceTier })

  fireAndForget(c, logRequestAsync({
    ...logBase,
    model,
    promptTokens, completionTokens, totalTokens,
    serviceTier: serviceTier ?? null,
    costUsd: cost?.totalCost ?? null,
    responseBody: resBodyJson,
    errorMessage: upstreamRes.ok ? null : resBodyText.slice(0, 1000),
  }))

  return new Response(resBodyText, {
    status: upstreamRes.status,
    headers: buildDownstreamHeaders(upstreamRes.headers),
  })
})
