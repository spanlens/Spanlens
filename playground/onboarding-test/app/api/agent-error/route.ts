import { NextResponse } from 'next/server'
import { SpanlensClient, observe } from '@spanlens/sdk'

export async function POST() {
  const apiKey = process.env.SPANLENS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'SPANLENS_API_KEY missing' }, { status: 500 })
  }

  const client = new SpanlensClient({ apiKey })
  const trace = client.startTrace({ name: 'agent.error.demo' })

  try {
    // Step 1: succeeds
    await observe(
      trace,
      { name: 'step_ok', spanType: 'tool' },
      async () => {
        await new Promise<void>((r) => setTimeout(r, 50))
        return { status: 'ok' }
      },
    )

    // Step 2: always throws — observe() catches it, marks span as error, re-throws
    await observe(
      trace,
      { name: 'step_fail', spanType: 'llm' },
      async () => {
        await new Promise<void>((r) => setTimeout(r, 80))
        throw new Error('Simulated LLM timeout after 80ms')
      },
    )

    // Should not reach here
    await trace.end({ status: 'completed' })
    return NextResponse.json({ ok: true, traceId: trace.traceId })
  } catch (err) {
    await trace.end({
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({
      ok: true,  // HTTP 200 — the error is expected, trace created successfully
      traceId: trace.traceId,
      errorCaptured: err instanceof Error ? err.message : String(err),
    })
  }
}
