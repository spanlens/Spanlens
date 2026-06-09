import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
import { enforceQuota } from '../middleware/quota.js'
import { proxyRateLimit } from '../middleware/rateLimit.js'
import { calculateCost } from '../lib/cost.js'
import { logRequestAsync, parseLogBodyMode } from '../lib/logger.js'
import { resolvePromptVersion } from '../lib/resolve-prompt-version.js'
import { fireAndForget } from '../lib/wait-until.js'
import { parseGeminiResponse, extractGeminiStreamText } from '../parsers/gemini.js'
import { scanAll } from '../lib/security-scan.js'
import { getDecryptedProviderKey, buildUpstreamHeaders, buildDownstreamHeaders, isBlockingEnabled } from './utils.js'
import { cancelReaderSilently, makeStreamDeadline, readWithDeadline } from './stream-deadline.js'
import { ApiError } from '../lib/errors.js'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
const UPSTREAM_TIMEOUT_MS = parseInt(process.env['UPSTREAM_TIMEOUT_MS'] ?? '35000', 10)

export const geminiProxy = new Hono<ApiKeyContext>()

geminiProxy.use('*', authApiKey)
geminiProxy.use('*', requireFullScope)
geminiProxy.use('*', proxyRateLimit)
geminiProxy.use('*', enforceQuota)

geminiProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()

  const organizationId = c.get('organizationId')
  // Narrowing: requireFullScope + DB CHECK constraint guarantee non-null. See openai.ts.
  const projectId = c.get('projectId') as string
  const apiKeyId = c.get('apiKeyId')

  const providerKey = await getDecryptedProviderKey(apiKeyId, 'gemini')
  if (!providerKey) {
    throw new ApiError(
      'NO_PROVIDER_KEY',
      'No active Gemini provider key registered for this Spanlens key',
      { provider: 'gemini' },
    )
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
    throw new ApiError(
      'INJECTION_BLOCKED',
      'Request blocked by Spanlens security policy: prompt injection detected.',
    )
  }

  const startMs = Date.now()
  const fetchBody = c.req.method !== 'GET' && c.req.method !== 'HEAD' ? reqBodyText : null
  const upstreamAbort = new AbortController()
  const upstreamTimer = setTimeout(() => upstreamAbort.abort(), UPSTREAM_TIMEOUT_MS)
  let upstreamRes: Response
  try {
    upstreamRes = await fetch(originalUrl.toString(), {
      method: c.req.method,
      headers,
      body: fetchBody,
      signal: upstreamAbort.signal,
    })
  } catch (err) {
    clearTimeout(upstreamTimer)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(
        'UPSTREAM_TIMEOUT',
        `Upstream request timed out after ${UPSTREAM_TIMEOUT_MS}ms`,
        { provider: 'gemini', timeoutMs: UPSTREAM_TIMEOUT_MS },
      )
    }
    console.error('[gemini-proxy] upstream fetch error:', msg)
    throw new ApiError('UPSTREAM_FAILED', `Upstream request failed: ${msg}`, {
      provider: 'gemini',
    })
  }
  clearTimeout(upstreamTimer)
  const latencyMs = Date.now() - startMs
  const proxyOverheadMs = startMs - handlerStartMs

  // Extract model name from the path (e.g. /v1/models/gemini-1.5-pro:streamGenerateContent)
  const modelMatch = /\/models\/([^/:]+)/.exec(originalPath)
  const isStreaming = /:streamGenerateContent/.test(originalPath)

  const traceId = c.req.header('x-trace-id') ?? null
  const resolved = await resolvePromptVersion(
    organizationId,
    c.req.header('x-spanlens-prompt-version') ?? null,
    traceId,
  )
  const promptVersionId = resolved?.versionId ?? null

  const logBase = {
    organizationId,
    projectId,
    apiKeyId,
    provider: 'gemini',
    latencyMs,
    proxyOverheadMs,
    statusCode: upstreamRes.status,
    requestBody: reqBodyJson,
    errorMessage: null as string | null,
    traceId,
    spanId: c.req.header('x-span-id') ?? null,
    promptVersionId,
    providerKeyId: providerKey.id,
    userId: c.req.header('x-spanlens-user') ?? null,
    sessionId: c.req.header('x-spanlens-session') ?? null,
    logBodyMode: parseLogBodyMode(c.req.header('x-spanlens-log-body')),
    preComputedRequestFlags: requestFlags,
  }

  // ── Streaming path (:streamGenerateContent) ───────────────────────────────
  // Pass chunks straight to the client AND buffer for token/text extraction.
  // Without this, the previous code did `await upstreamRes.text()` and blocked
  // the entire stream — the client never got streaming, just one big payload.
  if (isStreaming && upstreamRes.body) {
    const downstreamHeaders = buildDownstreamHeaders(upstreamRes.headers)
    downstreamHeaders.forEach((value, key) => c.header(key, value))
    c.status(upstreamRes.status as 200)

    const upstreamBody = upstreamRes.body

    return stream(c, async (honoStream) => {
      const reader = upstreamBody.getReader()
      const decoder = new TextDecoder()
      const deadline = makeStreamDeadline(handlerStartMs)
      const chunks: string[] = []
      let truncated = false

      pump: for (;;) {
        const outcome = await readWithDeadline(reader, deadline)
        switch (outcome.kind) {
          case 'done':
            break pump
          case 'timeout':
            truncated = true
            console.warn('[gemini-stream] deadline reached, closing gracefully')
            await cancelReaderSilently(reader)
            break pump
          case 'error':
            console.error('[gemini-stream] reader error:', outcome.error)
            break pump
          case 'chunk':
            await honoStream.write(outcome.value)
            chunks.push(decoder.decode(outcome.value, { stream: true }))
            break
        }
      }

      const buffer = chunks.join('')
      const text = extractGeminiStreamText(buffer.split('\n'))

      // Best-effort: try to recover usage + model from the last full JSON chunk.
      let model = modelMatch?.[1] ?? ''
      let promptTokens = 0
      let completionTokens = 0
      let totalTokens = 0
      let serviceTier: import('../parsers/openai.js').ServiceTier | undefined
      try {
        // Try parsing the joined buffer as a JSON array of partial responses
        const lastChunkText = buffer.trim().replace(/^\[/, '').replace(/\]$/, '')
        const candidates = lastChunkText.split(/(?<=})\s*,\s*(?=\{)/g)
        const last = candidates[candidates.length - 1]
        if (last) {
          const parsed = parseGeminiResponse(JSON.parse(last) as Record<string, unknown>)
          if (parsed) {
            model = parsed.model || model
            promptTokens = parsed.promptTokens
            completionTokens = parsed.completionTokens
            totalTokens = parsed.totalTokens
            serviceTier = parsed.serviceTier
          }
        }
      } catch { /* usage may be missing on aborted streams — acceptable */ }

      // Capture-rate signal: a stream that produced output bytes but yielded no
      // extractable text usually means the parser drifted from Gemini's wire
      // format. Surface it as a warn for log monitoring.
      if (buffer.length > 0 && text.length === 0) {
        console.warn(
          '[gemini-stream] capture-empty: %d bytes received, 0 chars extracted (parser drift?)',
          buffer.length,
        )
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

      await logRequestAsync({
        ...logBase,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        serviceTier: serviceTier ?? null,
        costUsd: cost?.totalCost ?? null,
        responseBody,
        truncated,
      }).catch((err) => {
        console.error('[gemini-stream] log error:', err)
      })
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
  let serviceTier: import('../parsers/openai.js').ServiceTier | undefined

  if (upstreamRes.ok && resBodyJson) {
    try {
      const parsed = parseGeminiResponse(resBodyJson as Record<string, unknown>)
      if (parsed) {
        model = parsed.model || model
        promptTokens = parsed.promptTokens
        completionTokens = parsed.completionTokens
        totalTokens = parsed.totalTokens
        serviceTier = parsed.serviceTier
      }
    } catch { /* ignore */ }
  }

  const cost = calculateCost('gemini', model, { promptTokens, completionTokens, serviceTier })

  fireAndForget(c, logRequestAsync({
    ...logBase,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
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
