import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { enforceQuota } from '../middleware/quota.js'
import { proxyRateLimit } from '../middleware/rateLimit.js'
import { calculateCost } from '../lib/cost.js'
import { logRequestAsync } from '../lib/logger.js'
import { resolvePromptVersion } from '../lib/resolve-prompt-version.js'
import { fireAndForget } from '../lib/wait-until.js'
import { parseGeminiResponse } from '../parsers/gemini.js'
import { scanAll } from '../lib/security-scan.js'
import { getDecryptedProviderKey, getDecryptedProviderKeyById, buildUpstreamHeaders, buildDownstreamHeaders, isBlockingEnabled } from './utils.js'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'

export const geminiProxy = new Hono<ApiKeyContext>()

geminiProxy.use('*', authApiKey)
geminiProxy.use('*', proxyRateLimit)
geminiProxy.use('*', enforceQuota)

geminiProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()

  const organizationId = c.get('organizationId')
  const projectId = c.get('projectId')
  const apiKeyId = c.get('apiKeyId')

  const linkedKeyId = c.get('providerKeyId')
  const providerKey = linkedKeyId
    ? await getDecryptedProviderKeyById(linkedKeyId, organizationId)
    : await getDecryptedProviderKey(organizationId, projectId, 'gemini')
  if (!providerKey) {
    return c.json({ error: 'No active Gemini provider key configured for this organization' }, 400)
  }
  const decryptedKey = providerKey.plaintext

  const reqBodyText = await c.req.text()
  let reqBodyJson: Record<string, unknown> | null = null
  try {
    reqBodyJson = JSON.parse(reqBodyText) as Record<string, unknown>
  } catch { /* non-JSON — pass through */ }

  // Gemini uses ?key= query param, not Authorization header
  const originalPath = c.req.path.replace(/^\/proxy\/gemini/, '')
  const originalUrl = new URL(`${GEMINI_BASE}${originalPath}`)

  // Forward existing query params from client (except 'key'), then add our key
  const clientUrl = new URL(c.req.raw.url)
  clientUrl.searchParams.forEach((v, k) => {
    if (k !== 'key') originalUrl.searchParams.set(k, v)
  })
  originalUrl.searchParams.set('key', decryptedKey)

  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    'Content-Type': 'application/json',
  })
  headers.delete('authorization')

  // ── Security scan + blocking ───────────────────────────────────────────────
  const requestFlags = scanAll(reqBodyJson)
  const hasInjection = requestFlags.some((f) => f.type === 'injection')
  if (hasInjection && await isBlockingEnabled(projectId)) {
    return c.json({
      error: 'Request blocked by Spanlens security policy: prompt injection detected.',
      code: 'INJECTION_BLOCKED',
    }, 422)
  }

  const startMs = Date.now()
  const fetchBody = c.req.method !== 'GET' && c.req.method !== 'HEAD' ? reqBodyText : null
  let upstreamRes: Response
  try {
    upstreamRes = await fetch(originalUrl.toString(), {
      method: c.req.method,
      headers,
      body: fetchBody,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[gemini-proxy] upstream fetch error:', msg)
    return c.json({ error: `Upstream request failed: ${msg}` }, 502)
  }
  const latencyMs = Date.now() - startMs
  const proxyOverheadMs = startMs - handlerStartMs

  const resBodyText = await upstreamRes.text()
  let resBodyJson: unknown = null
  try { resBodyJson = JSON.parse(resBodyText) } catch { /* non-JSON response */ }

  // Extract model name from the path (e.g. /v1/models/gemini-1.5-pro:generateContent)
  const modelMatch = /\/models\/([^/:]+)/.exec(originalPath)
  let model = modelMatch?.[1] ?? ''
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0

  if (upstreamRes.ok && resBodyJson) {
    try {
      const parsed = parseGeminiResponse(resBodyJson as Record<string, unknown>)
      if (parsed) {
        model = parsed.model || model
        promptTokens = parsed.promptTokens
        completionTokens = parsed.completionTokens
        totalTokens = parsed.totalTokens
      }
    } catch { /* ignore */ }
  }

  const cost = calculateCost('gemini', model, { promptTokens, completionTokens })

  const traceId = c.req.header('x-trace-id') ?? null
  const resolved = await resolvePromptVersion(
    organizationId,
    c.req.header('x-spanlens-prompt-version') ?? null,
    traceId,
  )
  const promptVersionId = resolved?.versionId ?? null

  fireAndForget(c, logRequestAsync({
    organizationId,
    projectId,
    apiKeyId,
    provider: 'gemini',
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: cost?.totalCost ?? null,
    latencyMs,
    proxyOverheadMs,
    statusCode: upstreamRes.status,
    requestBody: reqBodyJson,
    responseBody: resBodyJson,
    errorMessage: upstreamRes.ok ? null : resBodyText.slice(0, 1000),
    traceId,
    spanId: c.req.header('x-span-id') ?? null,
    promptVersionId,
    providerKeyId: providerKey.id,
    preComputedRequestFlags: requestFlags,
  }))

  return new Response(resBodyText, {
    status: upstreamRes.status,
    headers: buildDownstreamHeaders(upstreamRes.headers),
  })
})
