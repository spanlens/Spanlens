import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

import { openaiProxy }     from './proxy/openai.js'
import { anthropicProxy }  from './proxy/anthropic.js'
import { geminiProxy }     from './proxy/gemini.js'

import { organizationsRouter } from './api/organizations.js'
import { projectsRouter }      from './api/projects.js'
import { apiKeysRouter }       from './api/apiKeys.js'
import { providerKeysRouter }  from './api/providerKeys.js'
import { requestsRouter }      from './api/requests.js'
import { statsRouter }         from './api/stats.js'

export const app = new Hono()

app.use('*', cors({
  origin: (origin) => {
    const allowed = [
      'https://spanlens-web.vercel.app',
      'http://localhost:3000',
    ]
    return allowed.includes(origin) ? origin : allowed[0]!
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}))
app.use('*', logger())

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// ── Proxy routes (authApiKey middleware) ──────────────────────
app.route('/proxy/openai',    openaiProxy)
app.route('/proxy/anthropic', anthropicProxy)
app.route('/proxy/gemini',    geminiProxy)

// ── REST API routes (authJwt middleware) ──────────────────────
app.route('/api/v1/organizations',  organizationsRouter)
app.route('/api/v1/projects',       projectsRouter)
app.route('/api/v1/api-keys',       apiKeysRouter)
app.route('/api/v1/provider-keys',  providerKeysRouter)
app.route('/api/v1/requests',       requestsRouter)
app.route('/api/v1/stats',          statsRouter)

export default app
