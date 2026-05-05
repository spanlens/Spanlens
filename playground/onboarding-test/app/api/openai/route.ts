// BEFORE `npx @spanlens/cli init`:
// This route uses the OpenAI client directly with OPENAI_API_KEY.
// You won't see the request anywhere except in your OpenAI usage page.
//
// AFTER the CLI patch:
//   - `new OpenAI(...)` becomes `createOpenAI()`
//   - Imports from `openai` become `import { createOpenAI } from '@spanlens/sdk/openai'`
//   - Requests flow through the Spanlens proxy and appear in /requests
//
// The CLI rewrites this file in place — re-run `pnpm dev` after.
import { NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST() {
  try {
    const t0 = Date.now()
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Reply with one word: ping' }],
      max_tokens: 8,
    })
    return NextResponse.json({
      ok: true,
      reply: res.choices[0]?.message?.content ?? '',
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
