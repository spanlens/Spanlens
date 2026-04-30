import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { enforceQuota } from '../middleware/quota.js'
import { calculateCost } from '../lib/cost.js'
import { logRequestAsync } from '../lib/logger.js'
import { resolvePromptVersion } from '../lib/resolve-prompt-version.js'
import { fireAndForget } from '../lib/wait-until.js'
import { parseAnthropicResponse } from '../parsers/anthropic.js'
import { scanAll } from '../lib/security-scan.js'
import { getDecryptedProviderKey, buildUpstreamHeaders, buildDownstreamHeaders, isBlockingEnabled } from './utils.js'
import { logAnthropicStream } from './stream-logger.js'

const ANTHROPIC_BASE = 'https://api.anthropic.com'

export const anthropicProxy = new Hono<ApiKeyContext>()

anthropicProxy.use('*', authApiKey)
anthropicProxy.use('*', enforceQuota)

anthropicProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()

  const organizationId = c.get('organizationId')
  const projectId = c.get('projectId')
  const apiKeyId = c.get('apiKeyId')

  const providerKey = await getDecryptedProviderKey(organizationId, projectId, 'anthropic')
  if (!providerKey) {
    return c.json({ error: 'No active Anthropic provider key configured for this organization' }, 400)
  }
  const decryptedKey = providerKey.plaintext

  const reqBodyText = await c.req.text()
  let reqBodyJson: Record<string, unknown> | null = null
  let isStreaming = false

  try {
    reqBodyJson = JSON.parse(reqBodyText) as Record<string, unknown>
    isStreaming = reqBodyJson.stream === true
  } catch { /* non-JSON — pass through */ }

  // ── Security scan + blocking ───────────────────────────────────────────────
  const requestFlags = scanAll(reqBodyJson)
  const hasInjection = requestFlags.some((f) => f.type === 'injection')
  if (hasInjection && await isBlockingEnabled(projectId)) {
    return c.json({
      error: 'Request blocked by Spanlens security policy: prompt injection detected.',
      code: 'INJECTION_BLOCKED',
    }, 422)
  }

  const path = c.req.path.replace(/^\/proxy\/anthropic/, '')
  const upstreamUrl = `${ANTHROPIC_BASE}${path}`

  // Anthropic uses x-api-key (not Authorization Bearer) + anthropic-version
  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    'x-api-key': decryptedKey,
    'anthropic-version': c.req.header('anthropic-version') ?? '2023-06-01',
    'Content-Type': 'application/json',
  })
  headers.delete('authorization')

  const startMs = Date.now()
  const fetchBody = c.req.method !== 'GET' && c.req.method !== 'HEAD' ? reqBodyText : null

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstreamUrl, { method: c.req.method, headers, body: fetchBody })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[anthropic-proxy] upstream fetch error:', msg)
    return c.json({ error: `Upstream request failed: ${msg}` }, 502)
  }
  const latencyMs = Date.now() - startMs
  const proxyOverheadMs = startMs - handlerStartMs

  const model = (reqBodyJson?.model as string | undefined) ?? ''
  const promptVersionId = await resolvePromptVersion(
    organizationId,
    c.req.header('x-spanlens-prompt-version') ?? null,
  )
  const logBase = {
    organizationId, projectId, apiKeyId,
    provider: 'anthropic',
    latencyMs, proxyOverheadMs, statusCode: upstreamRes.status,
    requestBody: reqBodyJson,
    responseBody: null,
    errorMessage: null,
    traceId: c.req.header('x-trace-id') ?? null,
    spanId: c.req.header('x-span-id') ?? null,
    promptVersionId,
    providerKeyId: providerKey.id,
    preComputedRequestFlags: requestFlags,
  }

  // ── Streaming path (Hono stream helper — required for Vercel Node.js runtime) ─
  if (isStreaming && upstreamRes.body) {
    const downstreamHeaders = buildDownstreamHeaders(upstreamRes.headers)
    downstreamHeaders.forEach((value, key) => c.header(key, value))
    c.status(upstreamRes.status as 200)

    const upstreamBody = upstreamRes.body

    return stream(c, async (honoStream) => {
      const reader = upstreamBody.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const lines: string[] = []

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break

          await honoStream.write(value)

          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n')
          buffer = parts.pop() ?? ''
          lines.push(...parts)
        }
        if (buffer.length > 0) lines.push(buffer)
      } catch (err) {
        console.error('[anthropic-stream] reader error:', err)
      }

      await logAnthropicStream(lines, { ...logBase, model }).catch((err) => {
        console.error('[anthropic-stream] log error:', err)
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
  let resolvedModel = model

  if (upstreamRes.ok && resBodyJson) {
    try {
      const parsed = parseAnthropicResponse(resBodyJson as Record<string, unknown>)
      if (parsed) {
        resolvedModel = parsed.model || model
        promptTokens = parsed.promptTokens
        completionTokens = parsed.completionTokens
        totalTokens = parsed.totalTokens
      }
    } catch { /* ignore */ }
  }

  const cost = calculateCost('anthropic', resolvedModel, { promptTokens, completionTokens })

  fireAndForget(c, logRequestAsync({
    ...logBase,
    model: resolvedModel,
    promptTokens, completionTokens, totalTokens,
    costUsd: cost?.totalCost ?? null,
    responseBody: resBodyJson,
    errorMessage: upstreamRes.ok ? null : resBodyText.slice(0, 1000),
  }))

  return new Response(resBodyText, { status: upstreamRes.status, headers: downstreamHeaders })
})
