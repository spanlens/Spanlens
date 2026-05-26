/**
 * Model availability test script.
 * Tests all chat_capable models against their provider APIs.
 * Uses a 1-token prompt to minimize cost.
 */

const OPENAI_KEY    = process.env.OPENAI_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY
const GEMINI_KEY    = process.env.GEMINI_KEY

if (!OPENAI_KEY || !ANTHROPIC_KEY || !GEMINI_KEY) {
  console.error('Missing keys. Set OPENAI_KEY, ANTHROPIC_KEY, GEMINI_KEY env vars.')
  process.exit(1)
}

// ── No-temperature models (same logic as playground-runner.ts) ────────────────
const NO_TEMP = new Set(['chat-latest', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.5'])
function skipTemp(model) { return /^o\d/.test(model) || NO_TEMP.has(model) }

// ── Models to test ────────────────────────────────────────────────────────────
const OPENAI_MODELS = [
  'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano',
  'gpt-5', 'gpt-5.1', 'gpt-5.2', 'gpt-5-mini', 'gpt-5-nano',
  'chat-latest',
  'o4-mini', 'o3', 'o3-mini', 'o1',
  'gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-05-13',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  'gpt-4-turbo', 'gpt-4-turbo-2024-04-09',
  'gpt-4', 'gpt-4-0613',
  'gpt-3.5-turbo', 'gpt-3.5-turbo-0125', 'gpt-3.5-turbo-1106',
]

const ANTHROPIC_MODELS = [
  'claude-opus-4-7', 'claude-opus-4-6',
  'claude-opus-4-5', 'claude-opus-4-5-20251101',
  'claude-opus-4-1', 'claude-opus-4-1-20250805',
  'claude-opus-4', 'claude-opus-4-0', 'claude-opus-4-20250514',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929',
  'claude-sonnet-4', 'claude-sonnet-4-0', 'claude-sonnet-4-20250514',
  'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
  'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229', 'claude-3-haiku-20240307',
]

const GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-customtools',
  'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  'gemini-2.5-flash-lite-preview-09-2025',
  'gemini-2.5-computer-use-preview-10-2025',
  'gemini-2.0-flash', 'gemini-2.0-flash-lite',
  'gemini-1.5-pro', 'gemini-1.5-flash',
]

// ── Test functions ────────────────────────────────────────────────────────────
async function testOpenAI(model) {
  const body = {
    model,
    messages: [{ role: 'user', content: 'Hi' }],
    max_completion_tokens: 5,
    ...(skipTemp(model) ? {} : { temperature: 0.7 }),
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = text
    try { msg = JSON.parse(text).error?.message ?? text } catch {}
    return { ok: false, error: msg }
  }
  return { ok: true }
}

async function testAnthropic(model) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 5,
      messages: [{ role: 'user', content: 'Hi' }],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = text
    try { msg = JSON.parse(text).error?.message ?? text } catch {}
    return { ok: false, error: msg }
  }
  return { ok: true }
}

async function testGemini(model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
      generationConfig: { maxOutputTokens: 5 },
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = text
    try { msg = JSON.parse(text).error?.message ?? text } catch {}
    return { ok: false, error: msg }
  }
  return { ok: true }
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function runBatch(label, models, testFn, concurrency = 3) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${label} (${models.length} models)`)
  console.log('─'.repeat(60))

  const ok = [], fail = []
  for (let i = 0; i < models.length; i += concurrency) {
    const batch = models.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(m => testFn(m).then(r => ({ model: m, ...r }))))
    for (const r of results) {
      const icon = r.ok ? '✓' : '✗'
      const line = r.ok ? `  ${icon} ${r.model}` : `  ${icon} ${r.model}\n      → ${r.error}`
      console.log(line)
      if (r.ok) ok.push(r.model); else fail.push({ model: r.model, error: r.error })
    }
    // small delay between batches to avoid rate limits
    if (i + concurrency < models.length) await new Promise(r => setTimeout(r, 500))
  }

  console.log(`\n  PASS ${ok.length} / FAIL ${fail.length}`)
  return fail
}

// ── Main ──────────────────────────────────────────────────────────────────────
const allFailed = []

const oaiFail  = await runBatch('OpenAI',    OPENAI_MODELS,    testOpenAI,    3)
const antFail  = await runBatch('Anthropic', ANTHROPIC_MODELS, testAnthropic, 3)
const gemFail  = await runBatch('Gemini',    GEMINI_MODELS,    testGemini,    3)

allFailed.push(...oaiFail.map(f => ({ provider: 'openai', ...f })))
allFailed.push(...antFail.map(f => ({ provider: 'anthropic', ...f })))
allFailed.push(...gemFail.map(f => ({ provider: 'gemini', ...f })))

if (allFailed.length > 0) {
  console.log('\n\n══ FAILED MODELS (need chat_capable = FALSE) ══')
  for (const f of allFailed) {
    console.log(`  ${f.provider} / ${f.model}`)
    console.log(`    ${f.error}`)
  }
} else {
  console.log('\n\n✓ All models passed!')
}
