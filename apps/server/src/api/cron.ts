import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/db.js'

/**
 * Vercel cron endpoints. Invoked hourly via `crons` entry in `vercel.json`.
 *
 * Security: Vercel injects an `Authorization: Bearer ${CRON_SECRET}` header
 * on cron-triggered requests. Every handler checks the header against the
 * `CRON_SECRET` env var so external callers cannot trigger these endpoints.
 *
 * If `CRON_SECRET` is unset, the endpoints refuse to run (fail-closed).
 */

export const cronRouter = new Hono()

function assertCronAuth(authHeader: string | undefined): string | null {
  const secret = process.env['CRON_SECRET']
  if (!secret) return 'CRON_SECRET not configured'
  if (authHeader !== `Bearer ${secret}`) return 'invalid cron auth'
  return null
}

// GET /cron/aggregate-usage
// Rolls up `requests` → `usage_daily` for today and yesterday.
// Yesterday covers the timezone edge: a request created at 23:59 UTC may
// only get aggregated after midnight UTC, so the first run of the new day
// finalizes yesterday's totals.
cronRouter.get('/aggregate-usage', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const results: { date: string; rows: number | null; error?: string }[] = []

  for (const date of [yesterday, today]) {
    const { data, error } = await supabaseAdmin.rpc('aggregate_usage_daily', {
      target_date: date,
    })
    if (error) {
      results.push({ date, rows: null, error: error.message })
    } else {
      results.push({ date, rows: data as number })
    }
  }

  return c.json({
    success: true,
    ran_at: now.toISOString(),
    results,
  })
})
