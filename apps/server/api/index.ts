import { handle } from 'hono/vercel'
import { app } from '../src/app.js'

// Vercel Edge Runtime — both Next.js App Router style and Pages Router style
// are declared for maximum compatibility across Vercel's runtime detectors.
export const runtime = 'edge'
export const config = { runtime: 'edge' }

export default handle(app)
