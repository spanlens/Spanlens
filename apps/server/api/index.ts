import { handle } from 'hono/vercel'
import { app } from '../src/app'

export const config = { runtime: 'nodejs' }

export default handle(app)
