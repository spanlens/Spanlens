import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * /api/v1/system — internal system monitoring endpoints.
 * Admin-only; not part of the public API.
 */

export const systemRouter = new Hono<JwtContext>()

systemRouter.use('*', authJwt)

const requireAdmin = requireRole('admin')

// GET /cron-runs — latest run per job name (last 90 days)
systemRouter.get('/cron-runs', requireAdmin, async (c) => {
  const { data, error } = await supabaseAdmin
    .from('cron_job_runs')
    .select('id, job_name, ran_at, status, duration_ms, error_message')
    .order('ran_at', { ascending: false })
    .limit(500)

  if (error) return c.json({ error: 'Failed to fetch cron runs' }, 500)

  // Collapse to latest run per job
  const latestByJob = new Map<string, typeof data[0]>()
  const recentByJob = new Map<string, typeof data>()

  for (const row of data ?? []) {
    if (!latestByJob.has(row.job_name)) latestByJob.set(row.job_name, row)
    const list = recentByJob.get(row.job_name) ?? []
    if (list.length < 5) list.push(row)
    recentByJob.set(row.job_name, list)
  }

  const jobs = Array.from(latestByJob.entries()).map(([jobName, latest]) => ({
    jobName,
    lastRanAt: latest.ran_at,
    lastStatus: latest.status,
    lastDurationMs: latest.duration_ms,
    lastErrorMessage: latest.error_message,
    recentRuns: recentByJob.get(jobName) ?? [],
  }))

  return c.json({ success: true, data: jobs })
})
