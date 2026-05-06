import { NextResponse } from 'next/server'
import { SpanlensClient, observeAnthropic } from '@spanlens/sdk'
import { createAnthropic } from '@spanlens/sdk/anthropic'

export async function POST() {
  const apiKey = process.env.SPANLENS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'SPANLENS_API_KEY missing' }, { status: 500 })
  }

  const client = new SpanlensClient({ apiKey })
  const trace = client.startTrace({ name: 'request.anthropic.ping' })
  const t0 = Date.now()

  try {
    const anthropic = createAnthropic()

    const res = await observeAnthropic(trace, 'ping', (headers) =>
      anthropic.messages.create(
        {
          model: 'claude-haiku-4-5',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with one word: ping' }],
        },
        { headers },
      ),
    )

    await trace.end({ status: 'completed' })

    const block = res.content[0]
    const reply = block?.type === 'text' ? block.text : ''

    return NextResponse.json({
      ok: true,
      traceId: trace.traceId,
      reply,
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
