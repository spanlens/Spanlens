// The CLI doesn't auto-patch Gemini yet (OpenAI-only for now).
// To route this through Spanlens, manually edit this file:
//
//   1. Install the SDK if you haven't:
//        pnpm add @spanlens/sdk
//
//   2. Replace the import + client init below with:
//        import { createGemini } from '@spanlens/sdk/gemini'
//        const genAI = createGemini()
//
//   3. Make sure SPANLENS_API_KEY is in .env.local.
//
// You can drop GEMINI_API_KEY from the env — Spanlens uses the provider
// key you registered on the dashboard.
import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')

export async function POST() {
  try {
    const t0 = Date.now()
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const res = await model.generateContent('Reply with one word: ping')
    return NextResponse.json({
      ok: true,
      reply: res.response.text(),
      usage: res.response.usageMetadata,
      latencyMs: Date.now() - t0,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
