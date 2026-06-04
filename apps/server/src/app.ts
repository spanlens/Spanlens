import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

import { openaiProxy }     from './proxy/openai.js'
import { anthropicProxy }  from './proxy/anthropic.js'
import { geminiProxy }     from './proxy/gemini.js'
import { azureProxy }      from './proxy/azure.js'

import { organizationsRouter } from './api/organizations.js'
import { projectsRouter }      from './api/projects.js'
import { apiKeysRouter }       from './api/apiKeys.js'
import { requestsRouter }      from './api/requests.js'
import { usersRouter }         from './api/users.js'
import { sessionsRouter }      from './api/sessions.js'
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
import { evalsRouter } from './api/evals.js'
import { datasetsRouter } from './api/datasets.js'
import { experimentsRouter } from './api/experiments.js'
import { humanEvalsRouter } from './api/human-evals.js'
import { recommendationsRouter } from './api/recommendations.js'
import { auditLogsRouter }     from './api/auditLogs.js'
import { membersRouter }       from './api/members.js'
import { orgInvitationsRouter, invitationsRouter, meInvitationsRouter } from './api/invitations.js'
import { dismissalsRouter }    from './api/dismissals.js'
import { userProfilesRouter }  from './api/userProfiles.js'
import { userConsentRouter }   from './api/userConsent.js'
import { waitlistRouter }      from './api/waitlist.js'
import { webhooksRouter }      from './api/webhooks.js'
import { exportsRouter }       from './api/exports.js'
import { openapiRouter }       from './api/openapi.js'
import { providerKeysRouter }  from './api/providerKeys.js'
import { meRouter }            from './api/me.js'
import { meRoleRouter }        from './api/meRole.js'
import { userNotificationPrefsRouter } from './api/userNotificationPrefs.js'
import { modelsRouter }        from './api/models.js'
import { systemRouter }       from './api/system.js'
import { feedbackRouter }     from './api/feedback.js'
import { adminModelPricesRouter } from './api/admin/modelPrices.js'
import { adminModelRecommendationsRouter } from './api/admin/modelRecommendations.js'
import { sharesRouter }           from './api/shares.js'
import { publicShareRouter }      from './api/publicShare.js'
import { badgeRouter }            from './api/badge.js'

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
// /health — basic liveness probe (no DB ping; always returns 200 if process is up).
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// /health/deep — components view. Returns 503 if ClickHouse is unreachable
// so external monitoring (Better Stack, UptimeRobot, etc.) can page on the
// real outage, not just process liveness. `/health` stays cheap for Vercel's
// own liveness checks.
//
// Response shape:
//   { status: 'ok' | 'degraded', clickhouse: { ok, latencyMs }, fallback: { queue } }
//
// Concurrency: ping + queue-size query run in parallel to keep p95 low even
// when one of them is slow.
app.get('/health/deep', async (c) => {
  const { pingClickhouse } = await import('./lib/clickhouse.js')
  const { fallbackQueueSize } = await import('./lib/fallback-replay.js')

  const start = Date.now()
  const [chOk, fallbackQueue] = await Promise.all([
    pingClickhouse().catch(() => false),
    fallbackQueueSize().catch(() => null),
  ])
  const chLatency = Date.now() - start

  const overallOk = chOk
  return c.json(
    {
      status: overallOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      clickhouse: { ok: chOk, latencyMs: chLatency },
      // Null means the lookup itself failed (e.g. Supabase down) — not an
      // empty queue. Distinguish for triage.
      fallback: { queue: fallbackQueue },
    },
    overallOk ? 200 : 503,
  )
})

// ── Proxy routes (authApiKey middleware) ──────────────────────
app.route('/proxy/openai',    openaiProxy)
app.route('/proxy/anthropic', anthropicProxy)
app.route('/proxy/gemini',    geminiProxy)
app.route('/proxy/azure',     azureProxy)

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
app.route('/share',           publicShareRouter)  // PLG Loop ① — public share viewer, per-IP rate limited
app.route('/badge',           badgeRouter)        // PLG Loop ③ — README badge SVG, per-IP rate limited

// ── Dashboard API rate limit (120 req/min, all plans) ────────
// Runs before authJwt using a token hash as the key — no extra
// DB lookup needed. Fails open so public endpoints are unaffected.
app.use('/api/v1/*', apiRateLimit)

// ── CLI introspection (authApiKey middleware) ─────────────────
// MUST be registered BEFORE any sub-router that mounts at the broad
// `/api/v1` prefix with `.use('*', authJwt)` (evalsRouter and
// humanEvalsRouter below). Hono runs middleware that matches the path
// in registration order — if those routers' JWT wildcard middleware
// is registered first, it intercepts `/api/v1/me/key-info` with the
// misleading "Invalid or expired token" 401 before `authApiKey` ever
// runs, breaking the `sl_live_*` introspection used by
// `npx @spanlens/cli init`.
// Mounted at the EXACT key-info path (not /api/v1/me) so meRouter's
// own `.use('*', authApiKey)` cannot accidentally swallow sibling
// JWT-only routes like /api/v1/me/role.
app.route('/api/v1/me/key-info',    meRouter)

// ── REST API routes (authJwt middleware) ──────────────────────
app.route('/api/v1/organizations',  organizationsRouter)
app.route('/api/v1/projects',       projectsRouter)
app.route('/api/v1/api-keys',       apiKeysRouter)
app.route('/api/v1/provider-keys',  providerKeysRouter)
app.route('/api/v1/requests',       requestsRouter)
app.route('/api/v1/users',          usersRouter)
app.route('/api/v1/sessions',       sessionsRouter)
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
app.route('/api/v1/invitations', invitationsRouter)           // public GET /accept — must be before evalsRouter/humanEvalsRouter
// Must be mounted BEFORE evalsRouter/humanEvalsRouter for the same reason
// meRouter is: those two mount at the broad `/api/v1` prefix with
// `.use('*', authJwt)`, so any route registered after them and matching
// their wildcard gets the misleading "Invalid or expired token" 401
// instead of running its own (here: dual JWT / sl_live_*) auth.
app.route('/api/v1/recommendations', recommendationsRouter)
app.route('/api/v1',                evalsRouter)
app.route('/api/v1/datasets',       datasetsRouter)
app.route('/api/v1/experiments',    experimentsRouter)
app.route('/api/v1',                humanEvalsRouter)
app.route('/api/v1/audit-logs',     auditLogsRouter)
app.route('/api/v1/organizations/:orgId/members', membersRouter)
app.route('/api/v1/organizations/:orgId/invitations', orgInvitationsRouter)
app.route('/api/v1/me/pending-invitations', meInvitationsRouter)
app.route('/api/v1/dismissals',     dismissalsRouter)
app.route('/api/v1/me/profile',     userProfilesRouter)
app.route('/api/v1/me/consent',     userConsentRouter)
app.route('/api/v1/me/notification-prefs', userNotificationPrefsRouter)  // JWT-auth — per-user email prefs
app.route('/api/v1/me/role',        meRoleRouter)    // JWT-auth — current user's org role (sidebar uses this)
app.route('/api/v1/models',         modelsRouter)    // JWT-auth — model catalog (grouped by provider) for Playground
app.route('/api/v1/webhooks',       webhooksRouter)
app.route('/api/v1/exports',        exportsRouter)
app.route('/api/v1/system',         systemRouter)
app.route('/api/v1/feedback',       feedbackRouter)
app.route('/api/v1/shares',         sharesRouter)   // PLG Loop ① — owner-side CRUD

// ── Admin routes (authJwt + requireSystemAdmin via SPANLENS_ADMIN_EMAILS) ──
app.route('/api/v1/admin/model-prices', adminModelPricesRouter)
app.route('/api/v1/admin/model-recommendations', adminModelRecommendationsRouter)

export default app
