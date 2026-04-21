/**
 * Spanlens E2E Streaming Test
 *
 * 실제 LLM API 호출을 통해 전체 프록시 파이프라인을 검증합니다.
 * 사전 조건:
 *   1. Spanlens 서버가 실행 중이어야 합니다 (로컬 또는 프로덕션)
 *   2. 대시보드에서 OpenAI / Anthropic / Gemini provider key를 등록해야 합니다
 *   3. 대시보드에서 프로젝트 및 API key를 생성해야 합니다
 *
 * 실행 방법:
 *   PROXY_URL=https://spanlens-server.vercel.app \
 *   SPANLENS_API_KEY=sl-xxxxxxxxxxxxxxxx \
 *   pnpm --filter server tsx scripts/test-e2e.ts
 *
 * 로컬 서버 테스트:
 *   PROXY_URL=http://localhost:3001 \
 *   SPANLENS_API_KEY=sl-xxxxxxxxxxxxxxxx \
 *   pnpm --filter server tsx scripts/test-e2e.ts
 *
 * 특정 프로바이더만 테스트:
 *   SKIP_ANTHROPIC=1 SKIP_GEMINI=1 ... pnpm --filter server tsx scripts/test-e2e.ts
 */

import 'dotenv/config'

const BASE = (process.env.PROXY_URL ?? 'http://localhost:3001').replace(/\/$/, '')
const API_KEY = process.env.SPANLENS_API_KEY
const SKIP_OPENAI = Boolean(process.env.SKIP_OPENAI)
const SKIP_ANTHROPIC = Boolean(process.env.SKIP_ANTHROPIC)
const SKIP_GEMINI = Boolean(process.env.SKIP_GEMINI)

// ── Terminal colors ────────────────────────────────────────────────────────────

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

// ── Setup validation ──────────────────────────────────────────────────────────

if (!API_KEY) {
  console.error(red('❌  SPANLENS_API_KEY is required'))
  console.error(dim('   대시보드 → Projects → New API key 에서 생성'))
  process.exit(1)
}

console.log(bold('\n🔬 Spanlens E2E Streaming Test'))
console.log(dim(`   Proxy: ${BASE}`))
console.log(dim(`   API Key: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}\n`))

// ── Test runner ───────────────────────────────────────────────────────────────

interface TestResult {
  name: string
  passed: boolean
  detail: string
  durationMs: number
}

const results: TestResult[] = []

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now()
  try {
    await fn()
    const ms = Date.now() - start
    results.push({ name, passed: true, detail: 'OK', durationMs: ms })
    console.log(`  ${green('✓')} ${name} ${dim(`(${ms}ms)`)}`)
  } catch (err) {
    const ms = Date.now() - start
    const detail = err instanceof Error ? err.message : String(err)
    results.push({ name, passed: false, detail, durationMs: ms })
    console.log(`  ${red('✗')} ${name} ${dim(`(${ms}ms)`)}`)
    console.log(`    ${dim(detail)}`)
  }
}

function skip(name: string, reason: string): void {
  console.log(`  ${yellow('○')} ${name} ${dim(`[skipped: ${reason}]`)}`)
}

// ── SSE reader helper ──────────────────────────────────────────────────────────
// [DONE] 수신 즉시 reader를 cancel해서 무한 대기를 방지합니다.

async function collectSSELines(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  const lines: string[] = []
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''

      let sawDone = false
      for (const line of parts) {
        if (line.trim()) {
          lines.push(line)
          // OpenAI SSE는 [DONE]으로 끝남 — 이후 스트림은 닫히지 않을 수 있어서 명시적으로 중단
          if (line.includes('[DONE]') || line.includes('message_stop')) {
            sawDone = true
            break
          }
        }
      }
      if (sawDone) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  if (buffer.trim()) lines.push(buffer)
  return lines
}

// ── OpenAI Tests ──────────────────────────────────────────────────────────────

if (SKIP_OPENAI) {
  skip('OpenAI — non-streaming chat', 'SKIP_OPENAI=1')
  skip('OpenAI — streaming chat (usage in last chunk)', 'SKIP_OPENAI=1')
} else {
  console.log(bold('🔵 OpenAI'))

  await test('non-streaming chat completion', async () => {
    const res = await fetch(`${BASE}/proxy/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Reply with exactly the word: ok' }],
        max_tokens: 5,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    const json = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }

    if (!json.usage?.total_tokens) throw new Error('Missing usage.total_tokens in response')
    if (!json.choices?.[0]?.message?.content) throw new Error('Missing choices[0].message.content')
  })

  await test('streaming chat completion — SSE chunks + usage in last chunk', async () => {
    const res = await fetch(`${BASE}/proxy/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line' }],
        max_tokens: 30,
        stream: true,
        // NOTE: proxy injects stream_options.include_usage automatically
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    if (!res.body) throw new Error('No response body')

    const lines = await collectSSELines(res.body)
    const dataLines = lines.filter((l) => l.startsWith('data:') && !l.includes('[DONE]'))

    if (dataLines.length < 2) {
      throw new Error(`Only ${dataLines.length} data chunks received (expected ≥ 2)`)
    }

    // Proxy injects stream_options so the LAST chunk always has usage
    const lastDataLine = dataLines[dataLines.length - 1]!
    let lastPayload: { usage?: { total_tokens?: number } }
    try {
      lastPayload = JSON.parse(lastDataLine.slice(6)) as typeof lastPayload
    } catch {
      throw new Error(`Last data line is not valid JSON: ${lastDataLine}`)
    }

    if (!lastPayload.usage?.total_tokens) {
      throw new Error(
        'Last chunk is missing usage.total_tokens — ' +
        'stream_options.include_usage injection may have failed'
      )
    }
  })
}

// ── Anthropic Tests ───────────────────────────────────────────────────────────

if (SKIP_ANTHROPIC) {
  skip('Anthropic — non-streaming messages', 'SKIP_ANTHROPIC=1')
  skip('Anthropic — streaming: message_start has input_tokens', 'SKIP_ANTHROPIC=1')
  skip('Anthropic — streaming: message_delta has output_tokens [Known Gotcha #1]', 'SKIP_ANTHROPIC=1')
} else {
  console.log(bold('\n🟠 Anthropic'))

  await test('non-streaming messages', async () => {
    const res = await fetch(`${BASE}/proxy/anthropic/v1/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Reply with the word ok' }],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    const json = await res.json() as {
      content?: Array<{ text?: string }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }

    if (!json.usage?.input_tokens) throw new Error('Missing usage.input_tokens')
    if (!json.usage?.output_tokens) throw new Error('Missing usage.output_tokens')
    if (!json.content?.[0]?.text) throw new Error('Missing content[0].text')
  })

  await test('streaming messages — message_start has input_tokens [Known Gotcha #1a]', async () => {
    const res = await fetch(`${BASE}/proxy/anthropic/v1/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 20,
        stream: true,
        messages: [{ role: 'user', content: 'Count 1 2 3' }],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    if (!res.body) throw new Error('No response body')

    const lines = await collectSSELines(res.body)
    const dataLines = lines.filter((l) => l.startsWith('data:'))

    const msgStartLine = dataLines.find((l) => l.includes('"message_start"'))
    if (!msgStartLine) throw new Error('No message_start event received in stream')

    const payload = JSON.parse(msgStartLine.slice(6)) as {
      message?: { usage?: { input_tokens?: number } }
    }
    if (!payload.message?.usage?.input_tokens) {
      throw new Error('message_start missing usage.input_tokens — prompt token count will be 0!')
    }
  })

  await test('streaming messages — message_delta has output_tokens [Known Gotcha #1b]', async () => {
    const res = await fetch(`${BASE}/proxy/anthropic/v1/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 20,
        stream: true,
        messages: [{ role: 'user', content: 'Count 1 2 3' }],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    if (!res.body) throw new Error('No response body')

    const lines = await collectSSELines(res.body)
    const dataLines = lines.filter((l) => l.startsWith('data:'))

    // Anthropic puts completion tokens in message_delta (NOT the last chunk like OpenAI!)
    const msgDeltaLine = dataLines.find((l) => l.includes('"message_delta"'))
    if (!msgDeltaLine) throw new Error('No message_delta event received in stream')

    const payload = JSON.parse(msgDeltaLine.slice(6)) as {
      usage?: { output_tokens?: number }
    }
    if (!payload.usage?.output_tokens) {
      throw new Error(
        'message_delta missing usage.output_tokens — ' +
        'Anthropic streaming completion tokens will not be logged!'
      )
    }
  })
}

// ── Gemini Tests ──────────────────────────────────────────────────────────────

if (SKIP_GEMINI) {
  skip('Gemini — generateContent', 'SKIP_GEMINI=1')
} else {
  console.log(bold('\n🟢 Gemini'))

  await test('generateContent (non-streaming)', async () => {
    const res = await fetch(
      `${BASE}/proxy/gemini/v1/models/gemini-1.5-flash:generateContent`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with the word ok' }] }],
        }),
      }
    )

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: { totalTokenCount?: number; promptTokenCount?: number }
    }

    if (!json.usageMetadata?.totalTokenCount) throw new Error('Missing usageMetadata.totalTokenCount')
    if (!json.usageMetadata?.promptTokenCount) throw new Error('Missing usageMetadata.promptTokenCount')
  })
}

// ── Summary ───────────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.passed).length
const failed = results.filter((r) => !r.passed)
const total = results.length

console.log(bold('\n── Summary ──────────────────────────────'))
console.log(`  Passed: ${passed}/${total}`)

if (failed.length === 0) {
  console.log(green('\n  ✓ All E2E tests passed!'))
  console.log(dim('  Spanlens 대시보드 → Requests 탭에서 방금 로그된 요청을 확인하세요.'))
  console.log()
} else {
  console.log(red(`\n  ✗ ${failed.length} test(s) failed:`))
  for (const r of failed) {
    console.log(`    ${red('•')} ${r.name}`)
    console.log(`      ${dim(r.detail)}`)
  }
  console.log()
  console.log(dim('  트러블슈팅:'))
  console.log(dim('   - provider key가 대시보드에 등록되어 있는지 확인'))
  console.log(dim('   - ENCRYPTION_KEY가 서버와 일치하는지 확인'))
  console.log(dim('   - SPANLENS_API_KEY가 활성 상태인지 확인'))
  console.log()
  process.exit(1)
}
