import { NextResponse } from 'next/server'
import { SpanlensClient, observeGemini } from '@spanlens/sdk'
import { createGemini } from '@spanlens/sdk/gemini'

export async function POST() {
  const apiKey = process.env.SPANLENS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'SPANLENS_API_KEY missing' }, { status: 500 })
  }

  const client = new SpanlensClient({ apiKey })
  const trace = client.startTrace({ name: 'request.gemini.ping' })
  const t0 = Date.now()

  try {
    const genAI = createGemini()
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const res = await observeGemini(trace, 'ping', (headers) =>
      model.generateContent('Reply with one word: ping', { customHeaders: headers }),
    )

    await trace.end({ status: 'completed' })

    return NextResponse.json({
      ok: true,
      traceId: trace.traceId,
      reply: res.response.text(),
      usage: res.response.usageMetadata,
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
