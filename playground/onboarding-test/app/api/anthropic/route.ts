// BEFORE `npx @spanlens/cli init`:
// This route uses the Anthropic client directly with ANTHROPIC_API_KEY.
//
// AFTER the CLI patch (CLI 0.2.0+ auto-detects Anthropic):
//   - `new Anthropic(...)` becomes `createAnthropic()`
//   - Imports from '@anthropic-ai/sdk' become
//     `import { createAnthropic } from '@spanlens/sdk/anthropic'`
//   - apiKey/baseURL options stripped (the SDK reads SPANLENS_API_KEY)
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST() {
  try {
    // Lazy-instantiate inside the handler so a missing API key surfaces
    // as a normal JSON error response (caught below) instead of a
    // module-load throw that Next.js renders as an HTML error page.
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
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
