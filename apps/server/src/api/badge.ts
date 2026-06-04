import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { supabaseAdmin } from '../lib/db.js'
import { checkRateLimit } from '../lib/rate-limit.js'

/**
 * Public README badge (PLG Loop ③). Mounted at `/badge/:orgId.svg` on the
 * root app — bypasses authJwt.
 *
 * Why static SVG:
 *   GitHub's `camo` image proxy aggressively caches the response (multiple
 *   days). A dynamic badge ("12K requests/mo") would either lie until camo
 *   refetches or force a tiny TTL that defeats caching entirely. Static
 *   text removes the trade-off. A dynamic variant is on the backlog once
 *   the org count justifies it — see plans/plg.md.
 *
 * Why we still validate org existence:
 *   Per-org URLs give us future-proof analytics (which orgs adopted),
 *   and a 404 on garbage UUIDs blocks broken links from rendering a stray
 *   "Observed by Spanlens" image on totally unrelated repos.
 *
 * Caching:
 *   - public, max-age=3600 : browser
 *   - s-maxage=86400       : Vercel Edge / any shared CDN
 *   - stale-while-revalidate=604800 : serve stale for 7 days while we refetch
 *   Combined, this means ~1 origin hit per org per day even if the badge
 *   sits on a high-traffic README.
 */
export const badgeRouter = new Hono()

const BADGE_RATE_LIMIT = 300 // per IP per minute — generous for GitHub camo

const badgeRateLimit = createMiddleware(async (c, next) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  const allowed = await checkRateLimit(`badge:${ip}`, BADGE_RATE_LIMIT)
  if (!allowed) {
    c.header('Retry-After', '60')
    return c.text('Too many requests', 429)
  }
  return next()
})

badgeRouter.use('*', badgeRateLimit)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

badgeRouter.get('/:idSvg', async (c) => {
  const param = c.req.param('idSvg')
  // Path comes through as "<uuid>.svg" — strip the suffix and validate the
  // UUID shape before touching the DB. Saves a query on obvious garbage.
  if (!param.endsWith('.svg')) return c.notFound()
  const orgId = param.slice(0, -'.svg'.length)
  if (!UUID_RE.test(orgId)) return c.notFound()

  const { data } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('id', orgId)
    .maybeSingle()
  if (!data) return c.notFound()

  c.header('Content-Type', 'image/svg+xml; charset=utf-8')
  // GitHub's camo proxy honours these but adds its own TTL on top. The
  // important property is "the SVG is byte-identical for all viewers" so
  // camo's content-addressed cache merges them into one origin hit.
  c.header(
    'Cache-Control',
    'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
  )
  return c.body(SPANLENS_BADGE_SVG)
})

// shields.io-inspired layout. Width is hand-tuned so "observed by" / "Spanlens"
// sit centred under the small font Verdana stack that's available everywhere.
// Brand accent (#b45309 — the light-mode `--accent` from globals.css) on the
// right block keeps the badge visually consistent with the rest of the site.
const SPANLENS_BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="148" height="20" role="img" aria-label="Observed by Spanlens">
  <title>Observed by Spanlens</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="148" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="74" height="20" fill="#555"/>
    <rect x="74" width="74" height="20" fill="#b45309"/>
    <rect width="148" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text aria-hidden="true" x="37" y="15" fill="#010101" fill-opacity=".3">observed by</text>
    <text x="37" y="14">observed by</text>
    <text aria-hidden="true" x="111" y="15" fill="#010101" fill-opacity=".3">Spanlens</text>
    <text x="111" y="14">Spanlens</text>
  </g>
</svg>`
