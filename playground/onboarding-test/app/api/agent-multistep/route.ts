import { NextResponse } from 'next/server'
import { SpanlensClient, observeOpenAI } from '@spanlens/sdk'
import { createOpenAI } from '@spanlens/sdk/openai'

export async function POST() {
  const apiKey = process.env.SPANLENS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'SPANLENS_API_KEY missing' }, { status: 500 })
  }

  const client = new SpanlensClient({ apiKey })
  const trace = client.startTrace({ name: 'agent.multistep.demo' })

  try {
    const openai = createOpenAI()

    // Step 1: classify intent (LLM)
    const classify = await observeOpenAI(trace, 'classify_intent', (headers) =>
      openai.chat.completions.create(
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Classify in one word: "How do I reset password?"' }],
          max_tokens: 5,
        },
        { headers },
      ),
    )

    // Step 2: kb_search (tool span — no LLM, simulates vector search)
    const toolSpan = trace.span({ name: 'kb_search', spanType: 'tool' })
    await new Promise<void>((r) => setTimeout(r, 120))
    await toolSpan.end({
      status: 'completed',
      output: { hits: 3, top_score: 0.87 },
    })

    // Step 3: compose_reply (parent custom span wrapping a child LLM span)
    const composeSpan = trace.span({ name: 'compose_reply', spanType: 'custom' })
    const reply = await observeOpenAI(composeSpan, 'llm.compose', (headers) =>
      openai.chat.completions.create(
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'In one sentence: how to reset a password?' }],
          max_tokens: 30,
        },
        { headers },
      ),
    )
    await composeSpan.end({ status: 'completed' })

    await trace.end({ status: 'completed' })

    return NextResponse.json({
      ok: true,
      traceId: trace.traceId,
      classify: classify.choices[0]?.message?.content ?? '',
      reply: reply.choices[0]?.message?.content ?? '',
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
