import { app } from '../src/app.js'

export const config = { runtime: 'edge' }
export const runtime = 'edge'

// Hono's app.fetch is a standard Web API handler: (req: Request) => Promise<Response>
// This matches Vercel Edge function signature exactly — no adapter needed.
export default app.fetch
