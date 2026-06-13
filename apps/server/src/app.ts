import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { captureException } from '@sentry/node'

import { requestId } from './middleware/requestId.js'
import { ApiError, isApiError } from './lib/errors.js'

import { openaiProxy }     from './proxy/openai.js'
import { anthropicProxy }  from './proxy/anthropic.js'
import { geminiProxy }     from './proxy/gemini.js'
import { azureProxy }      from './proxy/azure.js'
import { mistralProxy }    from './proxy/mistral.js'
import { openrouterProxy } from './proxy/openrouter.js'

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
import { scoreConfigsRouter } from './api/scoreConfigs.js'
import { recommendationsRouter } from './api/recommendations.js'
import { auditLogsRouter }     from './api/auditLogs.js'
import { healthRouter }        from './api/health.js'
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
import { frontendErrorsRouter } from './api/frontendErrors.js'
import { meRouter }            from './api/me.js'
import { meRoleRouter }        from './api/meRole.js'
import { userNotificationPrefsRouter } from './api/userNotificationPrefs.js'
import { modelsRouter }        from './api/models.js'
import { systemRouter }       from './api/system.js'
import { feedbackRouter }     from './api/feedback.js'
import { adminModelPricesRouter } from './api/admin/modelPrices.js'
import { adminModelRecommendationsRouter } from './api/admin/modelRecommendations.js'
import { adminBackgroundMigrationsRouter } from './api/admin/backgroundMigrations.js'
import { adminAlertsRouter } from './api/admin/alerts.js'
import { adminFeedbackRouter } from './api/admin/feedback.js'
import { sharesRouter }           from './api/shares.js'
import { publicShareRouter }      from './api/publicShare.js'
import { badgeRouter }            from './api/badge.js'
import { pendingDeletionsRouter } from './api/pendingDeletions.js'

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
// Sprint 7 R-15: requestId before logger so the access log line carries
// the same id that the response header and the onError payload echo.
app.use('*', requestId)
app.use('*', logger())

// Health check routes extracted to api/health.ts for unit-test isolation.
// See that file for the contract and the rationale behind each endpoint.
//
// Three-level health surface (R-22):
//
//   /health        — liveness. Always 200 while the process is up. Vercel
//                    polls this internally; do not add DB pings here or the
//                    cold-start budget blows up. Now includes `version`
//                    (Vercel commit SHA) so we can correlate dashboards with
//                    the deployed build at a glance.
//
//   /health/ready  — readiness. Pings Postgres + ClickHouse + Upstash in
//                    parallel. Returns 503 if any dependency is unreachable
//                    so the load balancer / docker healthcheck can route
//                    around a half-broken instance. Cheap enough to run on
//                    every 30s docker healthcheck (no aggregate queries,
//                    one round-trip per dep). Upstash is best-effort — when
//                    KV_REST_API_URL is unset we report `skipped`, not a
//                    failure (local dev / preview environments often run
//                    without the KV store).
//
//   /health/deep   — components view + R-11 entry-trigger metrics. Adds the
//                    `crons.max_runtime_ms` (24h MAX duration_ms from
//                    cron_job_runs) and `webhooks.backlog_count`
//                    (webhook_deliveries that missed their retry window)
//                    fields so external monitoring (Better Stack,
//                    UptimeRobot, our own dashboards) can page on slow cron
//                    drift or webhook delivery failure spikes before they
//                    show up as customer complaints. `concurrent_count` is
//                    intentionally NOT here — cron_job_runs only INSERTs on
//                    completion, so in-progress count requires either an
//                    extra `cron_in_progress` table or Postgres advisory
//                    locks. Tracked as R-22 follow-up; the 503 path doesn't
//                    depend on it.
//
// Why split readiness from deep: readiness must be fast enough to run
// every 30s on a tight container loop without melting Supabase. The deep
// endpoint aggregates last-24h MAX(duration_ms) etc. which is fine to call
// every 5 min but not every 30 sec.
app.route('/', healthRouter)

// ── Proxy routes (authApiKey middleware) ──────────────────────
app.route('/proxy/openai',    openaiProxy)
app.route('/proxy/anthropic', anthropicProxy)
app.route('/proxy/gemini',    geminiProxy)
app.route('/proxy/azure',     azureProxy)
app.route('/proxy/mistral',   mistralProxy)
app.route('/proxy/openrouter', openrouterProxy)

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
app.route('/api/v1/frontend-errors', frontendErrorsRouter) // /app/{error,global-error}.tsx + <ErrorBoundary> sink

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
// pendingDeletions must be mounted BEFORE evalsRouter/humanEvalsRouter for
// the same wildcard-collision reason as recommendations (gotcha #3).
app.route('/api/v1/pending-deletions', pendingDeletionsRouter)
// scoreConfigs has the same wildcard-collision concern as the routes above.
app.route('/api/v1/score-configs',  scoreConfigsRouter)
// feedback must be mounted BEFORE evalsRouter/humanEvalsRouter for the same
// reason as recommendations / pending-deletions / score-configs above.
// `feedbackRouter`'s GET / is intentionally PUBLIC (anonymous roadmap list);
// mounting after the `/api/v1` wildcard routers lets their `.use('*', authJwt)`
// catch the request first and 401 every anonymous visitor with "Missing or
// invalid Authorization header" — exactly what production dogfood after
// PR #304 surfaced. Per-route authJwt inside feedbackRouter only fires for
// requests that actually reach this router.
app.route('/api/v1/feedback',       feedbackRouter)
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
app.route('/api/v1/shares',         sharesRouter)   // PLG Loop ① — owner-side CRUD

// ── Admin routes (authJwt + requireSystemAdmin via SPANLENS_ADMIN_EMAILS) ──
app.route('/api/v1/admin/model-prices', adminModelPricesRouter)
app.route('/api/v1/admin/model-recommendations', adminModelRecommendationsRouter)
app.route('/api/v1/admin/background-migrations', adminBackgroundMigrationsRouter)
app.route('/api/v1/admin/alerts', adminAlertsRouter)
app.route('/api/v1/admin/feedback', adminFeedbackRouter)

// Sprint 7 R-15 + R-20: global error handler. Every router can now
// `throw new ApiError('CODE', 'message?')` and rely on this handler to
// serialise to the standard `{ error: { code, message, details?, requestId } }`
// shape. Unknown errors fall through to a 500 with Sentry capture so the
// client never sees a stack trace.
app.onError((err, c) => {
  // requestId middleware runs before any route handler, so this should
  // always be present in production. Treat absent as null so a unit
  // test that exercises onError without mounting requestId still works.
  const requestId =
    ((c as unknown as { get: (k: string) => string | undefined }).get('requestId')) ?? null

  if (isApiError(err)) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
          requestId,
        },
      },
      err.status as ContentfulStatusCode,
    )
  }

  // Unknown error. Capture to Sentry (no-op when SENTRY_DSN is unset) and
  // return an opaque 500 so we never leak stack traces or internal state.
  captureException(err, { tags: { request_id: requestId ?? 'unknown' } })
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected error',
        requestId,
      },
    },
    500,
  )
})

// Sprint 7 R-20: expose the Hono app's type so downstream packages can
// derive a typed client. apps/web/lib/api-client.ts does
// `hc<AppType>(...)` for full end-to-end type safety on every fetch.
// Type-only export (no runtime cost; tsc strips it from the build).
export type AppType = typeof app
// Reference ApiError so the import is not tree-shaken away even if no
// route is yet using it; remove this line in Sprint 8 once at least one
// handler in app.ts itself throws ApiError.
export type _AppErrorMarker = ApiError

export default app
