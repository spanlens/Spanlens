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
import { parseOpenAIResponse } from '../parsers/openai.js'
import { scanAll } from '../lib/security-scan.js'
import { getDecryptedProviderKey, buildUpstreamHeaders, buildDownstreamHeaders, isBlockingEnabled } from './utils.js'
import { logOpenAIStream } from './stream-logger.js'
import { cancelReaderSilently, makeStreamDeadline, readWithDeadline } from './stream-deadline.js'

const OPENAI_BASE = 'https://api.openai.com'
const UPSTREAM_TIMEOUT_MS = parseInt(process.env['UPSTREAM_TIMEOUT_MS'] ?? '35000', 10)

export const openaiProxy = new Hono<ApiKeyContext>()

openaiProxy.use('*', authApiKey)
openaiProxy.use('*', requireFullScope)
openaiProxy.use('*', proxyRateLimit)
openaiProxy.use('*', enforceQuota)

openaiProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()

  const organizationId = c.get('organizationId')
  const projectId = c.get('projectId')
  const apiKeyId = c.get('apiKeyId')

  // Nested-keys model: provider key pool is owned by this Spanlens key.
  // Path = "/proxy/openai/..." → resolve OpenAI key under apiKeyId.
  const providerKey = await getDecryptedProviderKey(apiKeyId, 'openai')
  if (!providerKey) {
    return c.json({ error: 'No active OpenAI provider key registered for this Spanlens key' }, 400)
  }
  const decryptedKey = providerKey.plaintext

  const reqBodyText = await c.req.text()
  let reqBodyJson: Record<string, unknown> | null = null
  let isStreaming = false

  try {
    reqBodyJson = JSON.parse(reqBodyText) as Record<string, unknown>
    isStreaming = reqBodyJson.stream === true

    // Inject stream_options so the last chunk includes usage
    if (isStreaming) {
      reqBodyJson = {
        ...reqBodyJson,
        stream_options: { include_usage: true },
      }
    }
  } catch { /* non-JSON body — pass through */ }

  // ── Security scan + blocking ───────────────────────────────────────────────
  // Scan request body BEFORE forwarding upstream. If injection is detected and
  // blocking is enabled for this project, reject immediately (422).
  // PII-only flags are never blocked — they may be legitimate user data.
  const requestFlags = scanAll(reqBodyJson)
  const hasInjection = requestFlags.some((f) => f.type === 'injection')
  if (hasInjection && await isBlockingEnabled(projectId)) {
    return c.json({
      error: 'Request blocked by Spanlens security policy: prompt injection detected.',
      code: 'INJECTION_BLOCKED',
    }, 422)
  }

  const path = c.req.path.replace(/^\/proxy\/openai/, '')
  const upstreamUrl = `${OPENAI_BASE}${path}`

  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    Authorization: `Bearer ${decryptedKey}`,
    'Content-Type': 'application/json',
  })

  const startMs = Date.now()
  const fetchBody =
    c.req.method !== 'GET' && c.req.method !== 'HEAD'
      ? isStreaming && reqBodyJson ? JSON.stringify(reqBodyJson) : reqBodyText
      : null

  const upstreamAbort = new AbortController()
  const upstreamTimer = setTimeout(() => upstreamAbort.abort(), UPSTREAM_TIMEOUT_MS)
  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstreamUrl, { method: c.req.method, headers, body: fetchBody, signal: upstreamAbort.signal })
  } catch (err) {
    clearTimeout(upstreamTimer)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (err instanceof Error && err.name === 'AbortError') {
      return c.json({ error: `Upstream request timed out after ${UPSTREAM_TIMEOUT_MS}ms` }, 504)
    }
    console.error('[openai-proxy] upstream fetch error:', msg)
    return c.json({ error: `Upstream request failed: ${msg}` }, 502)
  }
  clearTimeout(upstreamTimer)
  const latencyMs = Date.now() - startMs
  // Pre-fetch overhead: auth + key decryption + body parsing (our cost, not provider's)
  const proxyOverheadMs = startMs - handlerStartMs

  const model = (reqBodyJson?.model as string | undefined) ?? ''
  const traceId = c.req.header('x-trace-id') ?? null
  const resolved = await resolvePromptVersion(
    organizationId,
    c.req.header('x-spanlens-prompt-version') ?? null,
    traceId,
  )
  const promptVersionId = resolved?.versionId ?? null
  const logBase = {
    organizationId, projectId, apiKeyId,
    provider: 'openai',
    latencyMs, proxyOverheadMs, statusCode: upstreamRes.status,
    requestBody: reqBodyJson,
    responseBody: null,
    errorMessage: null,
    traceId,
    spanId: c.req.header('x-span-id') ?? null,
    promptVersionId,
    providerKeyId: providerKey.id,
    userId: c.req.header('x-spanlens-user') ?? null,
    sessionId: c.req.header('x-spanlens-session') ?? null,
    logBodyMode: parseLogBodyMode(c.req.header('x-spanlens-log-body')),
    preComputedRequestFlags: requestFlags,
  }

  // ── Streaming path (Hono stream helper) ──────────────────────────────────
  if (isStreaming && upstreamRes.body) {
    const downstreamHeaders = buildDownstreamHeaders(upstreamRes.headers)
    downstreamHeaders.forEach((value, key) => c.header(key, value))
    c.status(upstreamRes.status as 200)

    const upstreamBody = upstreamRes.body

    return stream(c, async (honoStream) => {
      const reader = upstreamBody.getReader()
      const decoder = new TextDecoder()
      const deadline = makeStreamDeadline(handlerStartMs)
      let buffer = ''
      const lines: string[] = []
      let truncated = false

      pump: for (;;) {
        const outcome = await readWithDeadline(reader, deadline)
        switch (outcome.kind) {
          case 'done':
            break pump
          case 'timeout':
            truncated = true
            console.warn('[openai-stream] deadline reached, closing gracefully')
            await cancelReaderSilently(reader)
            break pump
          case 'error':
            console.error('[openai-stream] reader error:', outcome.error)
            break pump
          case 'chunk': {
            await honoStream.write(outcome.value)
            buffer += decoder.decode(outcome.value, { stream: true })
            const parts = buffer.split('\n')
            buffer = parts.pop() ?? ''
            lines.push(...parts)
            break
          }
        }
      }
      if (buffer.length > 0) lines.push(buffer)

      await logOpenAIStream(lines, { ...logBase, model }, { truncated }).catch((err) => {
        console.error('[openai-stream] log error:', err)
      })
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
  let serviceTier: import('../parsers/openai.js').ServiceTier | undefined

  if (upstreamRes.ok && resBodyJson) {
    try {
      const parsed = parseOpenAIResponse(resBodyJson as Record<string, unknown>)
      if (parsed) {
        resolvedModel = parsed.model || model
        promptTokens = parsed.promptTokens
        completionTokens = parsed.completionTokens
        totalTokens = parsed.totalTokens
        cacheReadTokens = parsed.cacheReadTokens ?? 0
        cacheWriteTokens = parsed.cacheWriteTokens ?? 0
        serviceTier = parsed.serviceTier
      }
    } catch { /* ignore */ }
  }

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
