import 'dotenv/config'
import { createOpenAI } from '@spanlens/sdk/openai'

async function main(): Promise<void> {
  const proxyBase = process.env.SPANLENS_PROXY_BASE
  const openai = createOpenAI({
    ...(proxyBase ? { baseURL: `${proxyBase}/proxy/openai/v1` } : {}),
  })

  console.log('[openai] sending chat/completions...')
  const t0 = Date.now()

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Say "hello from openai" in 4 words.' }],
    max_tokens: 16,
  })

  const elapsed = Date.now() - t0
  console.log(`[openai] ✅ ${elapsed}ms`)
  console.log(`[openai] usage:`, res.usage)
  console.log(`[openai] reply: ${res.choices[0]?.message?.content}`)
}

main().catch((err) => {
  console.error('[openai] ❌', err)
  process.exit(1)
})
