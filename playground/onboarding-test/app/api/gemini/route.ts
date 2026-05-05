// BEFORE `npx @spanlens/cli init`:
// This route uses the GoogleGenerativeAI client directly with GEMINI_API_KEY.
//
// AFTER the CLI patch (CLI 0.2.0+ auto-detects Gemini):
//   - `new GoogleGenerativeAI(...)` becomes `createGemini()`
//   - Imports from '@google/generative-ai' become
//     `import { createGemini } from '@spanlens/sdk/gemini'`
//   - apiKey arg dropped (the SDK reads SPANLENS_API_KEY)
import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export async function POST() {
  try {
    // Lazy-instantiate inside the handler so a missing API key surfaces
    // as a normal JSON error response (caught below) instead of a
    // module-load throw that Next.js renders as an HTML error page.
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
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
