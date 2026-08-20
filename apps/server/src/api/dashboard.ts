import { Hono } from 'hono'
import type { JwtContext } from '../middleware/authJwt.js'
import { authJwtOrApiKey } from '../middleware/authJwtOrApiKey.js'
import { parsePositiveFloat, parsePositiveInt } from '../lib/params.js'
import { recommendModelSwaps } from '../lib/model-recommend.js'
import { ApiError } from '../lib/errors.js'

import { fetchAlerts, type AlertRecord } from './alerts.js'
import { fetchAuditLogs, type AuditLogRow } from './auditLogs.js'
import { fetchPromptsWithStats } from './prompts.js'
import { fetchSecuritySummary, type SecuritySummaryItem } from './security.js'
import { computeSpendForecast, type SpendForecast } from './stats.js'

/**
 * GET /api/v1/dashboard/summary — one read for the dashboard's below-the-fold
 * panels.
 *
 * Why this exists
 * ---------------
 * The dashboard mounted a separate `useQuery` per panel, so a single page view
 * opened a fan of independent client requests whose latency added up in the
 * browser's connection queue rather than overlapping on the server. This route
 * fetches the same datasets in ONE `Promise.all`, so the whole set costs one
 * round-trip and is bounded by the slowest dataset instead of their sum.
 *
 * What is deliberately NOT here
 * -----------------------------
 * Only panels with no `refetchInterval` are folded in. `stats/models` and
 * `anomalies` both poll on a 30s live interval; merging a polling query into a
 * composite drags every other dataset onto the tightest cadence, which would
 * INCREASE total load — the opposite of the point. `dismissals` also stays out:
 * it is mutated from the UI and needs its own cache entry for the optimistic
 * update in `useDismissCard`.
 *
 * Partial-failure convention
 * --------------------------
 * A dashboard must not go blank because one panel's backing store is unwell.
 * Every dataset is attempted independently and a failing one resolves to
 * `null` while the rest return normally — the same null-on-failure convention
 * `/health/deep` uses for its individual metrics. `null` therefore means
 * "this lookup failed", which is distinct from `[]` ("succeeded, nothing to
 * show"); no successful fetch in this payload can produce `null`. The names of
 * the failed datasets are echoed in `meta.degraded` so a client can log or
 * surface the distinction without inspecting every key. The response stays
 * 200: a 500 here would blank panels that had perfectly good data.
 *
 * Query logic is never reimplemented in this file. Each dataset delegates to
 * the exported fetcher in the router that owns that resource, which is the
 * same function that route's own handler calls.
 */

export const dashboardRouter = new Hono<JwtContext>()

// `/api/v1/*` read route → dual auth, so Supabase JWTs (the dashboard) and
// `sl_live_*` keys (MCP server, BI tools) both reach it. Per CLAUDE.md's
// 인증 계층 section this is `authJwtOrApiKey`, never `authJwt` alone and never
// `requireFullScope` — the latter would lock out public read keys.
dashboardRouter.use('*', authJwtOrApiKey)

/** Keys of the `data` object, in response order. */
const DATASETS = [
  'alerts',
  'recommendations',
  'auditLogs',
  'prompts',
  'securitySummary',
  'spendForecast',
] as const

type DatasetKey = (typeof DATASETS)[number]

type PromptSummary = Awaited<ReturnType<typeof fetchPromptsWithStats>>[number]
type Recommendation = Awaited<ReturnType<typeof recommendModelSwaps>>[number]

export interface DashboardSummaryData {
  alerts: AlertRecord[] | null
  recommendations: Recommendation[] | null
  auditLogs: AuditLogRow[] | null
  prompts: PromptSummary[] | null
  securitySummary: SecuritySummaryItem[] | null
  spendForecast: SpendForecast | null
}

/**
 * Runs one dataset, converting any failure into `null`.
 *
 * The error is logged rather than rethrown: the caller has five other
 * datasets that are probably fine, and the client renders a `null` dataset
 * with the panel's existing empty state.
 */
async function attempt<T>(key: DatasetKey, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (err) {
    console.error(
      `[dashboard:summary] ${key} failed:`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * GET /api/v1/dashboard/summary
 *   ?hours=24        window for recommendations + security flag counts
 *   ?auditLimit=6    rows in the "Recent activity" strip (max 200)
 *   ?minSavings=5    minimum projected monthly saving for a recommendation
 */
dashboardRouter.get('/summary', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const hours = parsePositiveFloat(c.req.query('hours'), 24)
  const minSavingsUsd = parsePositiveFloat(c.req.query('minSavings'), 5)
  const auditLimit = Math.min(parsePositiveInt(c.req.query('auditLimit'), 6), 200)
  // The security summary window is clamped the same way GET
  // /api/v1/security/summary clamps it, so the two endpoints cannot disagree
  // about what a 90-day request means. `getSecuritySummary` interpolates this
  // as an integer INTERVAL, so the lower bound matters: a sub-hour `hours`
  // would otherwise round to 0 and silently return an empty window.
  const securityHours = Math.min(Math.max(1, Math.round(hours)), 720)
  // Prompt aggregates are pinned to 24h to match `usePrompts()`'s default —
  // the dashboard panel's empty state says "in the last 24h" in so many words.
  const promptSinceHours = 24

  // One Promise.all: total latency is the slowest dataset, not the sum. Each
  // entry is independently fault-isolated by `attempt`.
  const [alerts, recommendations, auditLogs, prompts, securitySummary, spendForecast] =
    await Promise.all([
      attempt('alerts', () => fetchAlerts(orgId)),
      attempt('recommendations', () =>
        recommendModelSwaps(orgId, { hours, minSavingsUsd }),
      ),
      attempt('auditLogs', async () => {
        const { rows } = await fetchAuditLogs(orgId, { limit: auditLimit, offset: 0 })
        return rows
      }),
      attempt('prompts', () =>
        fetchPromptsWithStats(orgId, { sinceHours: promptSinceHours }),
      ),
      attempt('securitySummary', async () => {
        const { summary } = await fetchSecuritySummary(orgId, securityHours)
        return summary
      }),
      attempt('spendForecast', () => computeSpendForecast(orgId)),
    ])

  const data: DashboardSummaryData = {
    alerts,
    recommendations,
    auditLogs,
    prompts,
    securitySummary,
    spendForecast,
  }

  // Derived from the payload rather than pushed to from inside `attempt`, so
  // the order is the stable DATASETS order instead of whichever promise
  // happened to reject first.
  const degraded = DATASETS.filter((key) => data[key] === null)

  return c.json({
    success: true,
    data,
    meta: {
      hours,
      auditLimit,
      minSavingsUsd,
      promptSinceHours,
      degraded,
    },
  })
})
