#!/usr/bin/env node
/**
 * Smoke test: hit one call per representative model on every provider, then
 * verify each row landed in ClickHouse with the right cost/service_tier.
 *
 * Each call asks for tiny output (max 5-10 tokens) to keep total cost <$0.10.
 * Reuses the Spanlens key from setup-smoke-test.mjs.
 */

const SPANLENS_KEY = process.env.SPANLENS_KEY
if (!SPANLENS_KEY) {
  console.error('Set SPANLENS_KEY (from setup-smoke-test.mjs output)')
  process.exit(1)
}

const BASE = 'http://localhost:3001'

const TESTS = [
  // ── OpenAI ─────────────────────────────────────────────────────────────────
  { id: 'oa-1', provider: 'openai', model: 'gpt-4o-mini',  desc: 'GPT-4o-mini baseline' },
  { id: 'oa-2', provider: 'openai', model: 'gpt-4o',       desc: 'GPT-4o' },
  { id: 'oa-3', provider: 'openai', model: 'gpt-5-mini',   desc: 'GPT-5 base mini' },
  { id: 'oa-4', provider: 'openai', model: 'gpt-5.5',      desc: 'GPT-5.5 flagship (tier)', extra: { service_tier: 'priority' } },
  // ── Anthropic ──────────────────────────────────────────────────────────────
  { id: 'an-1', provider: 'anthropic', model: 'claude-haiku-4-5',  desc: 'Claude Haiku 4.5' },
  { id: 'an-2', provider: 'anthropic', model: 'claude-sonnet-4-6', desc: 'Claude Sonnet 4.6' },
  { id: 'an-3', provider: 'anthropic', model: 'claude-opus-4-7',   desc: 'Claude Opus 4.7 (flagship)' },
  // ── Gemini ─────────────────────────────────────────────────────────────────
  { id: 'gm-1', provider: 'gemini', model: 'gemini-2.5-flash-lite', desc: 'Gemini 2.5 Flash Lite' },
  { id: 'gm-2', provider: 'gemini', model: 'gemini-2.5-flash',      desc: 'Gemini 2.5 Flash' },
  { id: 'gm-3', provider: 'gemini', model: 'gemini-2.5-pro',        desc: 'Gemini 2.5 Pro (tier)' },
]

async function callOpenAI(t) {
  const body = {
    model: t.model,
    messages: [{ role: 'user', content: `say ${t.id}` }],
    max_tokens: 5,
    ...t.extra,
  }
  const res = await fetch(`${BASE}/proxy/openai/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SPANLENS_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

async function callAnthropic(t) {
  const body = {
    model: t.model,
    max_tokens: 10,
    messages: [{ role: 'user', content: `say ${t.id}` }],
  }
  const res = await fetch(`${BASE}/proxy/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SPANLENS_KEY}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

async function callGemini(t) {
  const body = {
    contents: [{ parts: [{ text: `say ${t.id}` }] }],
    generationConfig: { maxOutputTokens: 10 },
  }
  const res = await fetch(
    `${BASE}/proxy/gemini/v1beta/models/${t.model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SPANLENS_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )
  return { status: res.status, body: await res.json() }
}

const callers = {
  openai: callOpenAI,
  anthropic: callAnthropic,
  gemini: callGemini,
}

console.log('── Running calls ─────────────────────────────────────────────')
for (const t of TESTS) {
  try {
    const result = await callers[t.provider](t)
    const ok = result.status === 200
    const errMsg = ok ? '' : ` · ${JSON.stringify(result.body?.error ?? result.body).slice(0, 80)}`
    console.log(`${ok ? '✓' : '✗'} ${t.id.padEnd(5)} ${t.provider.padEnd(10)} ${t.model.padEnd(40)} status=${result.status}${errMsg}`)
  } catch (err) {
    console.log(`✗ ${t.id.padEnd(5)} ${t.provider.padEnd(10)} ${t.model.padEnd(40)} EXCEPTION: ${err.message}`)
  }
  // Tiny pause so CH inserts don't pile up
  await new Promise((r) => setTimeout(r, 200))
}

console.log('\nWaiting 3s for async log writes to ClickHouse…')
await new Promise((r) => setTimeout(r, 3000))
console.log('Done. Run the CH query in the report step.')
