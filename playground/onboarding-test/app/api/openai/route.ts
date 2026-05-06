import { NextResponse } from 'next/server'
import { SpanlensClient, observeOpenAI } from '@spanlens/sdk'
import { createOpenAI } from '@spanlens/sdk/openai'

export async function POST() {
  const apiKey = process.env.SPANLENS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'SPANLENS_API_KEY missing' }, { status: 500 })
  }

  const client = new SpanlensClient({ apiKey })
  const trace = client.startTrace({ name: 'request.openai.ping' })
  const t0 = Date.now()

  try {
    const openai = createOpenAI()

    const res = await observeOpenAI(trace, 'ping', (headers) =>
      openai.chat.completions.create(
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Reply with one word: ping' }],
          max_tokens: 8,
        },
        { headers },
      ),
    )

    await trace.end({ status: 'completed' })

    return NextResponse.json({
      ok: true,
      traceId: trace.traceId,
      reply: res.choices[0]?.message?.content ?? '',
      usage: res.usage,
      latencyMs: Date.now() - t0,
    })
  } catch (err) {
    await trace.end({
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
