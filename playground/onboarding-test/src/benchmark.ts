import 'dotenv/config'
import { createOpenAI } from '@spanlens/sdk/openai'
import { createAnthropic } from '@spanlens/sdk/anthropic'
import { createGemini } from '@spanlens/sdk/gemini'
import { pollUntilRowAppears, type PollResult } from './poll-dashboard.js'

const SPANLENS_API_KEY = process.env.SPANLENS_API_KEY
const SPANLENS_JWT = process.env.SPANLENS_JWT
const PROXY_BASE = process.env.SPANLENS_PROXY_BASE ?? 'https://spanlens-server.vercel.app'
const API_BASE = process.env.SPANLENS_API_BASE ?? 'https://www.spanlens.io'

if (!SPANLENS_API_KEY) {
  console.error('❌ SPANLENS_API_KEY is required (.env)')
  process.exit(1)
}
if (!SPANLENS_JWT) {
  console.error('❌ SPANLENS_JWT is required (see .env.example for how to get it)')
  process.exit(1)
}

interface ProviderTest {
  name: 'openai' | 'anthropic' | 'gemini'
  call: () => Promise<{ usage: unknown; reply: string }>
}

const tests: ProviderTest[] = [
  {
    name: 'openai',
    call: async () => {
      const openai = createOpenAI({ baseURL: `${PROXY_BASE}/proxy/openai/v1` })
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Reply with one word: ping' }],
        max_tokens: 8,
      })
      return { usage: res.usage, reply: res.choices[0]?.message?.content ?? '' }
    },
  },
  {
    name: 'anthropic',
    call: async () => {
      const anthropic = createAnthropic({ baseURL: `${PROXY_BASE}/proxy/anthropic` })
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with one word: ping' }],
      })
      const block = res.content[0]
      const reply = block?.type === 'text' ? block.text : ''
      return { usage: res.usage, reply }
    },
  },
  {
    name: 'gemini',
    call: async () => {
      const genAI = createGemini({ baseUrl: `${PROXY_BASE}/proxy/gemini` })
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
      const res = await model.generateContent('Reply with one word: ping')
      return { usage: res.response.usageMetadata, reply: res.response.text() }
    },
  },
]

interface Outcome {
  provider: string
  upstreamMs: number
  ingestMs: number
  ok: boolean
  reply: string
  poll: PollResult
}

async function runOne(test: ProviderTest): Promise<Outcome> {
  console.log(`\n▶ ${test.name}`)

  // Mark `since` BEFORE the call so we don't pick up unrelated old rows.
  const since = new Date(Date.now() - 500) // 500ms slack for clock skew
  const t0 = Date.now()

  let result: Awaited<ReturnType<typeof test.call>>
  try {
    result = await test.call()
  } catch (err) {
    console.error(`  ❌ upstream call failed:`, err)
    throw err
  }

  const upstreamMs = Date.now() - t0
  console.log(`  ✓ provider 200 OK in ${upstreamMs}ms — reply: ${JSON.stringify(result.reply.slice(0, 40))}`)

  // Poll dashboard until row appears
  console.log(`  ⏱  polling /api/v1/requests for new row...`)
  const poll = await pollUntilRowAppears({
    jwt: SPANLENS_JWT!,
    apiBase: API_BASE,
    since,
    predicate: (row) => row.provider === test.name,
    timeoutMs: 30_000,
    intervalMs: 250,
  })

  if (poll.ok) {
    console.log(
      `  ✓ ingested in ${poll.latencyMs}ms (${poll.attempts} polls) — request id: ${poll.row?.id}`,
    )
  } else {
    console.log(`  ❌ NOT ingested within ${poll.latencyMs}ms (${poll.attempts} polls)`)
  }

  return {
    provider: test.name,
    upstreamMs,
    ingestMs: poll.latencyMs,
    ok: poll.ok,
    reply: result.reply,
    poll,
  }
}

async function main(): Promise<void> {
  console.log('═══ Spanlens onboarding benchmark ═══')
  console.log(`  proxy:     ${PROXY_BASE}`)
  console.log(`  dashboard: ${API_BASE}`)
  console.log(`  target:    ingest latency < 5000ms`)

  const outcomes: Outcome[] = []
  for (const test of tests) {
    try {
      outcomes.push(await runOne(test))
    } catch {
      outcomes.push({
        provider: test.name,
        upstreamMs: -1,
        ingestMs: -1,
        ok: false,
        reply: '',
        poll: { ok: false, latencyMs: -1, row: null, attempts: 0 },
      })
    }
  }

  console.log('\n═══ Summary ═══')
  console.log('provider     upstream    ingest     status')
  console.log('────────────────────────────────────────────')
  for (const o of outcomes) {
    const status = !o.ok ? '❌ failed' : o.ingestMs < 5000 ? '✓ <5s' : '⚠ slow'
    const upstream = o.upstreamMs < 0 ? '   — ' : `${String(o.upstreamMs).padStart(5)}ms`
    const ingest = o.ingestMs < 0 ? '   — ' : `${String(o.ingestMs).padStart(5)}ms`
    console.log(`  ${o.provider.padEnd(10)} ${upstream}    ${ingest}    ${status}`)
  }

  const allOk = outcomes.every((o) => o.ok && o.ingestMs < 5000)
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => {
  console.error('benchmark failed:', err)
  process.exit(1)
})
