// The CLI doesn't auto-patch Anthropic yet (OpenAI-only for now).
// To route this through Spanlens, manually edit this file:
//
//   1. Install the SDK if you haven't:
//        pnpm add @spanlens/sdk
//
//   2. Replace the import + client init below with:
//        import { createAnthropic } from '@spanlens/sdk/anthropic'
//        const anthropic = createAnthropic()
//
//   3. Make sure SPANLENS_API_KEY is in .env.local (the CLI adds it for you).
//
// You can keep ANTHROPIC_API_KEY out of the env entirely — Spanlens uses
// the provider key you registered on the dashboard.
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST() {
  try {
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
