import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * /api/v1/me/consent — append-only record of the user's acceptance
 * of the Terms of Service and Privacy Policy at signup (and any
 * subsequent re-acceptance prompts when those documents are revised).
 *
 *   POST /me/consent  body: { documents: [{ document, version }, ...] }
 *   GET  /me/consent              — return this user's accepted versions
 *
 * Writes capture IP + user-agent server-side from the incoming request,
 * not from the client body, so the audit row reflects what the server
 * actually observed.
 *
 * Schema reference: supabase/migrations/20260518100000_user_consents.sql
 */
export const userConsentRouter = new Hono<JwtContext>()

userConsentRouter.use('*', authJwt)

type AllowedDocument = 'terms' | 'privacy'
const ALLOWED_DOCUMENTS: readonly AllowedDocument[] = ['terms', 'privacy'] as const

interface ConsentItem {
  document: AllowedDocument
  version: string
}

interface RecordBody {
  documents?: unknown
}

function parseDocuments(input: unknown): ConsentItem[] | null {
  if (!Array.isArray(input)) return null
  const out: ConsentItem[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') return null
    const doc = (item as { document?: unknown }).document
    const version = (item as { version?: unknown }).version
    if (typeof doc !== 'string' || !ALLOWED_DOCUMENTS.includes(doc as AllowedDocument)) {
      return null
    }
    if (typeof version !== 'string' || version.trim().length === 0 || version.length > 32) {
      return null
    }
    out.push({ document: doc as AllowedDocument, version: version.trim() })
  }
  // Deduplicate (document, version) pairs in case the client sends both
  // a Terms and a Privacy row that happen to share a version string.
  const seen = new Set<string>()
  return out.filter((row) => {
    const key = `${row.document}:${row.version}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function readClientIp(headerValue: string | undefined): string | null {
  if (!headerValue) return null
  // X-Forwarded-For is "ip1, ip2, ip3" — Vercel puts the original client IP first
  const first = headerValue.split(',')[0]?.trim()
  if (!first) return null
  // Postgres INET will reject obviously malformed input — let it do the validation
  // by passing through. The basic shape check below is just to reject empty / huge strings.
  if (first.length > 64) return null
  return first
}

userConsentRouter.post('/', async (c) => {
  const userId = c.get('userId')

  let body: RecordBody
  try {
    body = (await c.req.json()) as RecordBody
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const items = parseDocuments(body.documents)
  if (!items || items.length === 0) {
    return c.json(
      {
        error:
          'documents must be a non-empty array of { document: "terms"|"privacy", version: string }',
      },
      400,
    )
  }

  // Capture IP + UA from the actual request — never trust client-supplied values
  const ipAddress = readClientIp(c.req.header('x-forwarded-for'))
  const userAgent = c.req.header('user-agent')?.slice(0, 512) ?? null

  const rows = items.map((row) => ({
    user_id: userId,
    document: row.document,
    version: row.version,
    ip_address: ipAddress,
    user_agent: userAgent,
  }))

  const { data, error } = await supabaseAdmin
    .from('user_consents')
    .insert(rows)
    .select('id, document, version, accepted_at')

  if (error) {
    console.error('[user-consent] insert failed:', error.message)
    return c.json({ error: 'Failed to record consent' }, 500)
  }

  return c.json({ success: true, data })
})

userConsentRouter.get('/', async (c) => {
  const userId = c.get('userId')

  const { data, error } = await supabaseAdmin
    .from('user_consents')
    .select('id, document, version, accepted_at')
    .eq('user_id', userId)
    .order('accepted_at', { ascending: false })

  if (error) {
    console.error('[user-consent] fetch failed:', error.message)
    return c.json({ error: 'Failed to fetch consent history' }, 500)
  }

  return c.json({ success: true, data: data ?? [] })
})
