import 'dotenv/config'
import { createAnthropic } from '@spanlens/sdk/anthropic'

async function main(): Promise<void> {
  const proxyBase = process.env.SPANLENS_PROXY_BASE
  const anthropic = createAnthropic({
    ...(proxyBase ? { baseURL: `${proxyBase}/proxy/anthropic` } : {}),
  })

  console.log('[anthropic] sending messages...')
  const t0 = Date.now()

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Say "hello from claude" in 4 words.' }],
  })

  const elapsed = Date.now() - t0
  console.log(`[anthropic] ✅ ${elapsed}ms`)
  console.log(`[anthropic] usage:`, res.usage)
  const block = res.content[0]
  if (block?.type === 'text') console.log(`[anthropic] reply: ${block.text}`)
}

main().catch((err) => {
  console.error('[anthropic] ❌', err)
  process.exit(1)
})
