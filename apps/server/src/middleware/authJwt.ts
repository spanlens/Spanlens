import { createMiddleware } from 'hono/factory'
import { supabaseClient } from '../lib/db.js'

export type JwtContext = {
  Variables: {
    userId: string
  }
}

export const authJwt = createMiddleware<JwtContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)
  const { data, error } = await supabaseClient.auth.getUser(token)

  if (error || !data.user) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  c.set('userId', data.user.id)
  return next()
})
