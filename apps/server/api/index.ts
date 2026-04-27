import { handle } from 'hono/vercel'
import { app } from '../src/app.js'

// Node.js runtime: 60s timeout (vs Edge 25s), full Node.js API support.
// IMPORTANT: Do NOT use `app.fetch` directly — it breaks on Vercel Node runtime.
// Use hono/vercel `handle()` adapter instead (confirmed working pattern).
export const runtime = 'nodejs'

export default handle(app)
