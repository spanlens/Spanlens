import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

import { openaiProxy }     from './proxy/openai.js'
import { anthropicProxy }  from './proxy/anthropic.js'
import { geminiProxy }     from './proxy/gemini.js'

import { organizationsRouter } from './api/organizations.js'
import { projectsRouter }      from './api/projects.js'
import { apiKeysRouter }       from './api/apiKeys.js'
import { requestsRouter }      from './api/requests.js'
import { savedFiltersRouter }  from './api/savedFilters.js'
import { statsRouter }         from './api/stats.js'
import { tracesRouter }        from './api/traces.js'
import { ingestRouter }        from './api/ingest.js'
import { otlpRouter }          from './api/otlp.js'
import { cronRouter }          from './api/cron.js'
import { apiRateLimit }        from './middleware/rateLimit.js'
import { billingRouter }       from './api/billing.js'
import { paddleWebhookRouter } from './api/paddleWebhook.js'
import { alertsRouter }        from './api/alerts.js'
import { anomaliesRouter }     from './api/anomalies.js'
import { securityRouter }      from './api/security.js'
import { promptsRouter }       from './api/prompts.js'
import { promptsPlaygroundRouter } from './api/prompts-playground.js'
import { promptExperimentsRouter } from './api/prompt-experiments.js'
import { recommendationsRouter } from './api/recommendations.js'
import { auditLogsRouter }     from './api/auditLogs.js'
import { membersRouter }       from './api/members.js'
import { orgInvitationsRouter, invitationsRouter, meInvitationsRouter } from './api/invitations.js'
import { dismissalsRouter }    from './api/dismissals.js'
import { userProfilesRouter }  from './api/userProfiles.js'
import { waitlistRouter }      from './api/waitlist.js'
import { webhooksRouter }      from './api/webhooks.js'
import { exportsRouter }       from './api/exports.js'
import { openapiRouter }       from './api/openapi.js'
import { providerKeysRouter }  from './api/providerKeys.js'
import { meRouter }            from './api/me.js'

export const app = new Hono()

app.use('*', cors({
  origin: (origin) => {
    const allowed = [
      'https://spanlens.io',
      'https://www.spanlens.io',
      'https://spanlens-web.vercel.app',
      'http://localhost:3000',
    ]
    // Also allow any Vercel preview deployment under the spanlens-web project
    if (origin && /^https:\/\/spanlens-[a-z0-9-]+-sunes26s-projects\.vercel\.app$/.test(origin)) {
      return origin
    }
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

// ── SDK ingestion routes (authApiKey middleware) ──────────────
app.route('/ingest',          ingestRouter)

// ── OTLP/HTTP receiver (authApiKey middleware) ────────────────
// Accepts POST /v1/traces — OTel SDK exports (gen_ai semconv)
app.route('/',                otlpRouter)

// ── Vercel cron routes (CRON_SECRET bearer auth) ─────────────
app.route('/cron',            cronRouter)

// ── Paddle webhook (HMAC-signed, public endpoint) ────────────
app.route('/webhooks',        paddleWebhookRouter)

// ── Public endpoints (no auth) ────────────────────────────────
app.route('/api/v1/waitlist', waitlistRouter)
app.route('/api/v1',          openapiRouter)   // GET /api/v1/openapi.json, GET /api/v1/docs

// ── Dashboard API rate limit (120 req/min, all plans) ────────
// Runs before authJwt using a token hash as the key — no extra
// DB lookup needed. Fails open so public endpoints are unaffected.
app.use('/api/v1/*', apiRateLimit)

// ── REST API routes (authJwt middleware) ──────────────────────
app.route('/api/v1/organizations',  organizationsRouter)
app.route('/api/v1/projects',       projectsRouter)
app.route('/api/v1/api-keys',       apiKeysRouter)
app.route('/api/v1/provider-keys',  providerKeysRouter)
app.route('/api/v1/requests',       requestsRouter)
app.route('/api/v1/saved-filters',  savedFiltersRouter)
app.route('/api/v1/stats',          statsRouter)
app.route('/api/v1/traces',         tracesRouter)
app.route('/api/v1/billing',        billingRouter)
app.route('/api/v1/alerts',         alertsRouter)
app.route('/api/v1/anomalies',      anomaliesRouter)
app.route('/api/v1/security',       securityRouter)
app.route('/api/v1/prompts/playground', promptsPlaygroundRouter)
app.route('/api/v1/prompts',        promptsRouter)
app.route('/api/v1/prompt-experiments', promptExperimentsRouter)
app.route('/api/v1/recommendations', recommendationsRouter)
app.route('/api/v1/audit-logs',     auditLogsRouter)
app.route('/api/v1/organizations/:orgId/members', membersRouter)
app.route('/api/v1/organizations/:orgId/invitations', orgInvitationsRouter)
app.route('/api/v1/invitations', invitationsRouter)
app.route('/api/v1/me/pending-invitations', meInvitationsRouter)
app.route('/api/v1/dismissals',     dismissalsRouter)
app.route('/api/v1/me/profile',     userProfilesRouter)
app.route('/api/v1/me',             meRouter)        // sl_live_* introspection (CLI), registered AFTER other /me/* prefixes
app.route('/api/v1/webhooks',       webhooksRouter)
app.route('/api/v1/exports',        exportsRouter)

export default app
