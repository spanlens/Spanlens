import 'dotenv/config'
import { createGemini } from '@spanlens/sdk/gemini'

async function main(): Promise<void> {
  const proxyBase = process.env.SPANLENS_PROXY_BASE
  const genAI = createGemini({
    ...(proxyBase ? { baseUrl: `${proxyBase}/proxy/gemini` } : {}),
  })

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  console.log('[gemini] sending generateContent...')
  const t0 = Date.now()

  const res = await model.generateContent('Say "hello from gemini" in 4 words.')

  const elapsed = Date.now() - t0
  console.log(`[gemini] ✅ ${elapsed}ms`)
  console.log(`[gemini] usage:`, res.response.usageMetadata)
  console.log(`[gemini] reply: ${res.response.text()}`)
}

main().catch((err) => {
  console.error('[gemini] ❌', err)
  process.exit(1)
})
