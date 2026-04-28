/**
 * GitGuardian HasMySecretLeaked client.
 *
 * The HMSL service uses k-anonymity: we send only a 5-char SHA-256 prefix,
 * and the server returns all known-leaked hashes that share that prefix.
 * The full hash is then compared client-side. The actual secret never
 * leaves our server, and even the full hash is never sent.
 *
 * NOTE on API shape: the request/response field names below match the
 * public HasMySecretLeaked spec at https://api.hasmysecretleaked.com.
 * If the live API rejects requests, this is the function to update —
 * the rest of the leak-detection pipeline is API-shape-agnostic.
 *
 * Privacy footnote: the GitGuardian docs offer an HMAC-keyed mode for
 * extra opacity ("payload mode"). We deliberately stick to the simpler
 * prefix mode here — for our use case (rare, post-hoc scans of
 * already-encrypted-at-rest secrets), the marginal privacy gain doesn't
 * justify the extra round-trip.
 */

import { sha256Hex } from './crypto.js'

const HMSL_BASE = 'https://api.hasmysecretleaked.com'

export interface LeakCheckOutcome {
  leaked: boolean
  /** Stored verbatim into provider_key_leak_scans.details. Keep PII-free. */
  details: Record<string, unknown>
}

interface HmslMatch {
  hash: string
  count?: number
}

/**
 * Check whether `plaintext` appears in GitGuardian's leaked-secrets corpus.
 *
 * Throws if `GITGUARDIAN_API_KEY` is unset or the upstream call fails. The
 * caller (cron handler) should `try/catch` and record `result='error'` on
 * the scan row so retries are deterministic.
 */
export async function checkSecretLeaked(plaintext: string): Promise<LeakCheckOutcome> {
  const apiKey = process.env['GITGUARDIAN_API_KEY']
  if (!apiKey) {
    throw new Error('GITGUARDIAN_API_KEY not configured')
  }

  const fullHash = await sha256Hex(plaintext)
  const prefix = fullHash.slice(0, 5)

  const res = await fetch(`${HMSL_BASE}/v1/hashes/${prefix}`, {
    method: 'GET',
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: 'application/json',
    },
  })

  if (res.status === 429) {
    throw new Error('HMSL rate limit (50/min or monthly quota exhausted)')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HMSL ${res.status}: ${text.slice(0, 200)}`)
  }

  const body = (await res.json().catch(() => ({}))) as { matches?: HmslMatch[] }
  const matches = body.matches ?? []

  const hit = matches.find((m) => m.hash === fullHash)
  return {
    leaked: hit !== undefined,
    details: {
      prefix,
      // Full hash is intentionally NOT stored — knowing it lets a malicious
      // DB reader replay HMSL queries to confirm a key is leaked.
      candidates_for_prefix: matches.length,
      match_count: hit?.count ?? null,
    },
  }
}
