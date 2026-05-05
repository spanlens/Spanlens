// Spanlens-integrated. Calls flow through https://spanlens-server.vercel.app/proxy/anthropic
// and appear in /requests automatically.
//
// Snippet copied directly from the dashboard's "Anthropic key added" dialog
// (Add provider key → success view). No CLI re-run needed — the same
// SPANLENS_API_KEY in .env.local already covers Anthropic.
import { NextResponse } from 'next/server'
import { createAnthropic } from '@spanlens/sdk/anthropic'

export async function POST() {
  try {
    // Lazy-instantiate inside the handler so a missing SPANLENS_API_KEY
    // surfaces as a normal JSON error response (caught below) instead of a
    // module-load throw that Next.js renders as an HTML error page.
    const anthropic = createAnthropic()
    const t0 = Date.now()
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with one word: ping' }],
    })
    const block = res.content[0]
    const reply = block?.type === 'text' ? block.text : ''
    return NextResponse.json({
      ok: true,
      reply,
      usage: res.usage,
      latencyMs: Date.now() - t0,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
