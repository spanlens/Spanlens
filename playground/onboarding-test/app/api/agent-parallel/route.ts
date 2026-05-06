import { NextResponse } from 'next/server'
import { SpanlensClient, observeOpenAI } from '@spanlens/sdk'
import { createOpenAI } from '@spanlens/sdk/openai'

export async function POST() {
  const apiKey = process.env.SPANLENS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'SPANLENS_API_KEY missing' }, { status: 500 })
  }

  const client = new SpanlensClient({ apiKey })
  const trace = client.startTrace({ name: 'agent.parallel.demo' })

  try {
    const openai = createOpenAI()

    // Fire 3 LLM calls in parallel — Gantt should show them overlapping on the timeline
    const [r1, r2, r3] = await Promise.all([
      observeOpenAI(trace, 'subtask_a', (headers) =>
        openai.chat.completions.create(
          { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Reply with letter A only' }], max_tokens: 3 },
          { headers },
        ),
      ),
      observeOpenAI(trace, 'subtask_b', (headers) =>
        openai.chat.completions.create(
          { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Reply with letter B only' }], max_tokens: 3 },
          { headers },
        ),
      ),
      observeOpenAI(trace, 'subtask_c', (headers) =>
        openai.chat.completions.create(
          { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Reply with letter C only' }], max_tokens: 3 },
          { headers },
        ),
      ),
    ])

    await trace.end({ status: 'completed' })

    return NextResponse.json({
      ok: true,
      traceId: trace.traceId,
      a: r1.choices[0]?.message?.content ?? '',
      b: r2.choices[0]?.message?.content ?? '',
      c: r3.choices[0]?.message?.content ?? '',
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
