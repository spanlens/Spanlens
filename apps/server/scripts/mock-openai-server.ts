/**
 * Mock OpenAI-compatible HTTP server (R-3 / Sprint 3-4).
 *
 * Stands in for OpenAI's chat/completions endpoint in E2E and load tests.
 * Set `OPENAI_API_BASE=http://mock-openai:4000/v1` on the server process
 * (docker-compose.dev.yml does this for the mock-openai service) and the
 * proxy will route to this instead of api.openai.com, so test runs do
 * not burn real budget.
 *
 * Shape covered
 *   - POST /v1/chat/completions
 *       body.stream === true  → text/event-stream with delta tokens
 *       body.stream !== true  → single JSON {choices:[...], usage:{...}}
 *   - GET  /health             → 200 "ok" for the docker healthcheck
 *
 * What we deliberately do NOT model
 *   - Authentication. The proxy strips its own Spanlens key before
 *     forwarding and adds an `Authorization: Bearer <provider key>` of
 *     its own. We accept any token (including none).
 *   - Tool calls, vision inputs, function calls. The smoke test only
 *     exercises the text path; widening this surface is R-3 follow-up.
 *   - Rate limit / error injection. Future R-3 work could add a query
 *     param like `?error=429` to deterministically trigger upstream
 *     failures for retry-path tests.
 *
 * Why a hand-written Node server instead of mockoon
 *   - Streaming. mockoon supports it but stub responses are static — we
 *     want the choice token count to follow the requested `max_tokens`
 *     so cost math stays plausible end-to-end.
 *   - One file, zero new dependencies — `tsx` already runs in dev.
 */

import { createServer } from 'node:http'

const PORT = Number(process.env['MOCK_OPENAI_PORT'] ?? 4000)

/** Static reply token. Multiple emitted in streaming mode. */
const REPLY_TOKEN = 'mock '

interface ChatRequest {
  model?: string
  stream?: boolean
  messages?: Array<{ role: string; content: string }>
  max_tokens?: number
}

/**
 * Build the non-streaming response body. Token counts mirror the
 * approximate length of the (single static) assistant message so cost
 * calculations on the proxy side land in the same ballpark as real
 * traffic — important for the dashboards the smoke test asserts on.
 */
function buildSingleResponse(body: ChatRequest): unknown {
  const model = body.model ?? 'gpt-4o-mini'
  const promptTokens = (body.messages ?? []).reduce(
    (acc, m) => acc + Math.ceil((m.content?.length ?? 0) / 4),
    0,
  ) || 10
  const completionContent = 'mock'
  const completionTokens = Math.max(1, Math.ceil(completionContent.length / 4))

  return {
    id: `chatcmpl-mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: completionContent },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}

/**
 * SSE chunk for the streaming path. OpenAI emits one delta per token
 * plus a terminal `[DONE]`. The proxy's parser (parsers/openai.ts)
 * extracts usage from the *last* chunk before `[DONE]`, so we set
 * `usage` on the final delta and omit it from intermediate ones.
 */
function buildStreamChunks(body: ChatRequest): string[] {
  const model = body.model ?? 'gpt-4o-mini'
  const tokenCount = Math.min(body.max_tokens ?? 8, 8)
  const promptTokens = (body.messages ?? []).reduce(
    (acc, m) => acc + Math.ceil((m.content?.length ?? 0) / 4),
    0,
  ) || 10
  const created = Math.floor(Date.now() / 1000)
  const id = `chatcmpl-mock-${Date.now()}`

  const chunks: string[] = []

  // Opening delta with role.
  chunks.push(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    })}\n\n`,
  )

  // Token deltas.
  for (let i = 0; i < tokenCount; i += 1) {
    chunks.push(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { content: REPLY_TOKEN }, finish_reason: null }],
      })}\n\n`,
    )
  }

  // Final delta — finish_reason + usage. OpenAI puts usage on the
  // chunk *before* [DONE]; the proxy parser depends on this layout.
  chunks.push(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: tokenCount,
        total_tokens: promptTokens + tokenCount,
      },
    })}\n\n`,
  )

  chunks.push('data: [DONE]\n\n')
  return chunks
}

/** Body collector with a guard so a runaway payload can't exhaust memory. */
async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const MAX_BYTES = 1024 * 1024 // 1MB cap is more than enough for chat completions
  let received = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buf = chunk as Buffer
    received += buf.byteLength
    if (received > MAX_BYTES) {
      throw new Error(`mock-openai: request body exceeded ${MAX_BYTES} bytes`)
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const server = createServer(async (req, res) => {
  // Health probe for the docker compose healthcheck.
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }

  // Anything not /v1/chat/completions just 404s — we don't ship the
  // surface area we don't need until a test asks for it.
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'Not implemented in mock-openai', type: 'not_found' } }))
    return
  }

  let parsed: ChatRequest
  try {
    const raw = await readBody(req)
    parsed = JSON.parse(raw) as ChatRequest
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : 'bad request', type: 'invalid_request_error' } }))
    return
  }

  if (parsed.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    for (const chunk of buildStreamChunks(parsed)) {
      res.write(chunk)
    }
    res.end()
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(buildSingleResponse(parsed)))
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console -- this is a script entry point, not application code
  console.log(`[mock-openai] listening on http://localhost:${PORT}`)
})
