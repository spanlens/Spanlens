#!/usr/bin/env node
/**
 * Sets up a prompt + 10 varied calls so /evals has data to score.
 *
 * Creates:
 *   1. Prompt "customer-support-smoke" v1 — friendly customer support persona
 *   2. 10 proxy calls with X-Spanlens-Prompt-Version header
 *      Mix of "easy" and "harder" customer messages so the judge sees a
 *      range of response qualities.
 */

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SPANLENS_KEY = process.env.SPANLENS_KEY
const ORG_ID = process.env.ORG_ID
const PROJECT_ID = process.env.PROJECT_ID

for (const [k, v] of Object.entries({
  ENCRYPTION_KEY, SUPABASE_SERVICE_ROLE_KEY, SPANLENS_KEY, ORG_ID, PROJECT_ID,
})) {
  if (!v) { console.error(`Missing env: ${k}`); process.exit(1) }
}

async function pgInsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${table} INSERT failed (${res.status}): ${text}`)
  return JSON.parse(text)
}

// ── 1. Create prompt version ────────────────────────────────────────────────
const promptContent = `You are a helpful, friendly customer support agent for SpanLens, an LLM observability platform.

Your goal: resolve customer issues efficiently and warmly. Always:
- Greet the customer
- Acknowledge their issue
- Provide a clear answer or next step
- End on a friendly note

If you don't know the answer, say so politely and offer to escalate.`

console.log('1. Creating prompt version...')
const [promptVersion] = await pgInsert('prompt_versions', {
  organization_id: ORG_ID,
  project_id: PROJECT_ID,
  name: 'customer-support-smoke',
  version: 1,
  content: promptContent,
  variables: [],
  metadata: { source: 'smoke-eval-setup' },
})
console.log(`   prompt_version_id = ${promptVersion.id}`)
console.log(`   name = ${promptVersion.name}, version = ${promptVersion.version}`)

// ── 2. Make 10 varied calls referencing this prompt version ────────────────
const messages = [
  'My subscription was charged twice this month, can you help?',
  'How do I export my data?',
  'WHY DOES YOUR APP CRASH ALL THE TIME???',  // angry user — tests if model stays friendly
  'Can you tell me how to integrate Spanlens with my Python app?',
  'thanks',  // very short — tests if model handles graceful close
  '내 결제가 안 됐는데 어떻게 해야 하지?',  // Korean — tests if it acknowledges + answers
  'I need to cancel my subscription immediately, this is urgent!',
  'What is the meaning of life?',  // off-topic
  'My API key keeps getting rejected, help',
  'Hi! I just signed up and I love the dashboard 😊',  // happy user — easy win for friendliness
]

console.log(`\n2. Running ${messages.length} OpenAI calls with X-Spanlens-Prompt-Version...`)

let success = 0
let failed = 0
for (let i = 0; i < messages.length; i++) {
  const msg = messages[i]
  try {
    const res = await fetch('http://localhost:3001/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SPANLENS_KEY}`,
        'Content-Type': 'application/json',
        // Linking the call to the prompt version so /evals can find it
        'X-Spanlens-Prompt-Version': `${promptVersion.name}@${promptVersion.version}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: promptContent },
          { role: 'user', content: msg },
        ],
        max_tokens: 150,
      }),
    })
    if (res.ok) {
      const json = await res.json()
      const reply = json.choices?.[0]?.message?.content ?? ''
      console.log(`   ${(i + 1).toString().padStart(2)}/10 ✓ "${msg.slice(0, 40)}..." → "${reply.slice(0, 60)}..."`)
      success++
    } else {
      console.log(`   ${(i + 1).toString().padStart(2)}/10 ✗ status=${res.status}`)
      failed++
    }
  } catch (err) {
    console.log(`   ${(i + 1).toString().padStart(2)}/10 ✗ ${err.message}`)
    failed++
  }
  await new Promise((r) => setTimeout(r, 300))
}

console.log(`\nResult: ${success} ok, ${failed} failed`)
console.log('\n── Next steps in the browser ───────────────────────────────────')
console.log(`Prompt name:    ${promptVersion.name}`)
console.log(`Prompt version: v${promptVersion.version}`)
console.log()
console.log('1. /prompts → click "customer-support-smoke" to see version + calls')
console.log('2. /evals  → "+ New evaluator"')
console.log('     - Prompt: customer-support-smoke')
console.log('     - Name: Friendliness')
console.log('     - Criterion: Is the response friendly, polite, and clearly addresses the customer issue?')
console.log('     - Judge provider: choose any (OpenAI / Anthropic / Gemini)')
console.log('     - Judge model: e.g. gpt-4o-mini or gemini-2.5-flash-lite (cheap)')
console.log('3. After saving → "Run" the evaluator → see scores roll in')
console.log('─────────────────────────────────────────────────────────────────')
