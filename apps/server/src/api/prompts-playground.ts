import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { aes256Decrypt } from '../lib/crypto.js'
import { calculateCost } from '../lib/cost.js'
import { interpolate, inferProvider } from '../lib/playground-runner.js'

export const promptsPlaygroundRouter = new Hono<JwtContext>()

promptsPlaygroundRouter.use('*', authJwt)

// Simple in-memory rate limit: 20 req per user per 60s
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(userId)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}

promptsPlaygroundRouter.post('/run', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  if (userId && !checkRateLimit(userId)) {
    return c.json({ error: 'Rate limit exceeded. Try again in a minute.' }, 429)
  }

  let body: {
    promptVersionId?: unknown
    variables?: unknown
    model?: unknown
    temperature?: unknown
    maxTokens?: unknown
    providerKeyId?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const promptVersionId = typeof body.promptVersionId === 'string' ? body.promptVersionId.trim() : ''
  if (!promptVersionId) return c.json({ error: 'promptVersionId is required' }, 400)

  const providerKeyId = typeof body.providerKeyId === 'string' ? body.providerKeyId.trim() : ''
  if (!providerKeyId) return c.json({ error: 'providerKeyId is required' }, 400)

  const model = typeof body.model === 'string' ? body.model.trim() : ''
  if (!model) return c.json({ error: 'model is required' }, 400)

  const temperature = typeof body.temperature === 'number'
    ? Math.min(2, Math.max(0, body.temperature))
    : 0.7
  const maxTokens = typeof body.maxTokens === 'number'
    ? Math.min(8192, Math.max(1, Math.round(body.maxTokens)))
    : 1024
  const variables = (body.variables && typeof body.variables === 'object' && !Array.isArray(body.variables))
    ? (body.variables as Record<string, string>)
    : {}

  // Fetch prompt version (scoped to org)
  const { data: pv, error: pvErr } = await supabaseAdmin
    .from('prompt_versions')
    .select('id, content')
    .eq('id', promptVersionId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (pvErr || !pv) return c.json({ error: 'Prompt version not found' }, 404)

  // Fetch the specified provider key (scoped to org, must be active)
  const { data: pkRow, error: pkErr } = await supabaseAdmin
    .from('provider_keys')
    .select('id, provider, encrypted_key')
    .eq('id', providerKeyId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  if (pkErr || !pkRow) {
    return c.json({ error: 'Provider key not found or inactive' }, 400)
  }

  // Validate key provider matches model
  const modelProvider = inferProvider(model)
  if (pkRow.provider !== modelProvider) {
    return c.json({
      error: `Model "${model}" requires a ${modelProvider} key, but selected key is ${pkRow.provider}.`,
    }, 400)
  }

  const plaintext = await aes256Decrypt(pkRow.encrypted_key as string)
  if (!plaintext) {
    return c.json({ error: 'Failed to decrypt provider key. Check your ENCRYPTION_KEY.' }, 500)
  }

  const { result: interpolated, missingVars } = interpolate(pv.content, variables)

  const startMs = Date.now()

  if (modelProvider === 'openai') {
    const upstreamRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${plaintext}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: interpolated }],
        temperature,
        max_tokens: maxTokens,
      }),
    })

    const latencyMs = Date.now() - startMs

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text().catch(() => '')
      return c.json({ error: `OpenAI error: ${text}`, upstreamStatus: upstreamRes.status }, 502)
    }

    const json = await upstreamRes.json() as {
      choices: Array<{ message: { content: string } }>
      usage: { prompt_tokens: number; completion_tokens: number }
      model: string
    }

    const responseText = json.choices?.[0]?.message?.content ?? ''
    const promptTokens = json.usage?.prompt_tokens ?? 0
    const completionTokens = json.usage?.completion_tokens ?? 0
    const resolvedModel = json.model ?? model
    const cost = calculateCost('openai', resolvedModel, { promptTokens, completionTokens })

    return c.json({
      success: true,
      data: {
        responseText,
        model: resolvedModel,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUsd: cost?.totalCost ?? null,
        latencyMs,
        missingVars,
      },
    })
  }

  // Anthropic
  const upstreamRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': plaintext,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: interpolated }],
      temperature,
    }),
  })

  const latencyMs = Date.now() - startMs

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text().catch(() => '')
    return c.json({ error: `Anthropic error: ${text}`, upstreamStatus: upstreamRes.status }, 502)
  }

  const json = await upstreamRes.json() as {
    content: Array<{ type: string; text: string }>
    usage: { input_tokens: number; output_tokens: number }
    model: string
  }

  const responseText = json.content?.find((b) => b.type === 'text')?.text ?? ''
  const promptTokens = json.usage?.input_tokens ?? 0
  const completionTokens = json.usage?.output_tokens ?? 0
  const resolvedModel = json.model ?? model
  const cost = calculateCost('anthropic', resolvedModel, { promptTokens, completionTokens })

  return c.json({
    success: true,
    data: {
      responseText,
      model: resolvedModel,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd: cost?.totalCost ?? null,
      latencyMs,
      missingVars,
    },
  })
})
