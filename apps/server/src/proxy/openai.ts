import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { enforceQuota } from '../middleware/quota.js'
import { calculateCost } from '../lib/cost.js'
import { logRequestAsync } from '../lib/logger.js'
import { resolvePromptVersion } from '../lib/resolve-prompt-version.js'
import { fireAndForget } from '../lib/wait-until.js'
import { parseOpenAIResponse } from '../parsers/openai.js'
import { getDecryptedProviderKey, buildUpstreamHeaders, buildDownstreamHeaders } from './utils.js'
import { logOpenAIStream } from './stream-logger.js'

const OPENAI_BASE = 'https://api.openai.com'

export const openaiProxy = new Hono<ApiKeyContext>()

openaiProxy.use('*', authApiKey)
openaiProxy.use('*', enforceQuota)

openaiProxy.all('/*', async (c) => {
  const organizationId = c.get('organizationId')
  const projectId = c.get('projectId')
  const apiKeyId = c.get('apiKeyId')

  const decryptedKey = await getDecryptedProviderKey(organizationId, 'openai')
  if (!decryptedKey) {
    return c.json({ error: 'No active OpenAI provider key configured for this organization' }, 400)
  }

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

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstreamUrl, { method: c.req.method, headers, body: fetchBody })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: `Upstream request failed: ${msg}` }, 502)
  }
  const latencyMs = Date.now() - startMs

  const model = (reqBodyJson?.model as string | undefined) ?? ''
  const promptVersionId = await resolvePromptVersion(
    organizationId,
    c.req.header('x-spanlens-prompt-version') ?? null,
  )
  const logBase = {
    organizationId, projectId, apiKeyId,
    provider: 'openai',
    latencyMs, statusCode: upstreamRes.status,
    requestBody: reqBodyJson,
    responseBody: null,
    errorMessage: null,
    traceId: c.req.header('x-trace-id') ?? null,
    spanId: c.req.header('x-span-id') ?? null,
    promptVersionId,
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
        console.error('[openai-stream] reader error:', err)
      }

      await logOpenAIStream(lines, { ...logBase, model }).catch((err) => {
        console.error('[openai-stream] log error:', err)
      })
    })
  }

  // ── Non-streaming path ────────────────────────────────────────────────────
  const downstreamHeaders = buildDownstreamHeaders(upstreamRes.headers)
  const resBodyText = await upstreamRes.text()
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let resolvedModel = model

  if (upstreamRes.ok) {
    try {
      const parsed = parseOpenAIResponse(JSON.parse(resBodyText) as Record<string, unknown>)
      if (parsed) {
        resolvedModel = parsed.model || model
        promptTokens = parsed.promptTokens
        completionTokens = parsed.completionTokens
        totalTokens = parsed.totalTokens
      }
    } catch { /* ignore */ }
  }

  const cost = calculateCost('openai', resolvedModel, { promptTokens, completionTokens })

  fireAndForget(c, logRequestAsync({
    ...logBase,
    model: resolvedModel,
    promptTokens, completionTokens, totalTokens,
    costUsd: cost?.totalCost ?? null,
    errorMessage: upstreamRes.ok ? null : resBodyText.slice(0, 1000),
  }))

  return new Response(resBodyText, { status: upstreamRes.status, headers: downstreamHeaders })
})
