/**
 * GitGuardian HasMySecretLeaked client.
 *
 * Endpoint:  GET https://api.hasmysecretleaked.com/v1/prefix/{prefix}
 * Auth:      `GGShield-Token: gg_pat_...` (NOT `Authorization: Bearer/Token`)
 * Rate:      5/day anon, 100+/day authed (workspace quota: 10k/month free)
 *
 * Privacy protocol (k-anonymity, hash-of-hash):
 *   1. fullHash    = SHA-256(secret)              — never transmitted
 *   2. prefix      = fullHash.slice(0, 5)         — sent in URL path
 *   3. server returns ALL leaked-secret hints whose hash starts with prefix
 *   4. hintToMatch = SHA-256(fullHash)            — computed locally
 *   5. compare hintToMatch against each `match.hint`
 *
 * Step 4 is what makes this trustless: GitGuardian never sees the full
 * hash either, only its prefix. Their `hint` field is the hash-of-hash
 * stored server-side at indexing time, so a match means an exact key
 * collision in their corpus.
 *
 * The `payload` field on a match is AES-256-GCM ciphertext keyed on the
 * full hash — decrypting it would reveal where the leak was found
 * (repo, file, line). We don't decrypt today; the leak email simply
 * tells the admin to rotate. Future enhancement: decrypt for richer
 * "leaked at <github.com/...>" context in the alert.
 */

import { sha256Hex } from './crypto.js'

const HMSL_BASE = 'https://api.hasmysecretleaked.com'

export interface LeakCheckOutcome {
  leaked: boolean
  /** Stored verbatim into provider_key_leak_scans.details. Keep PII-free. */
  details: Record<string, unknown>
}

interface HmslMatch {
  /** SHA-256(fullHash) — compare against locally-computed hash-of-hash. */
  hint: string
  /** AES-256-GCM ciphertext, decryption key = fullHash. Unused today. */
  payload?: string
}

interface HmslResponse {
  matches?: HmslMatch[]
}

/**
 * SHA-256 of a hex string interpreted as raw text. Used for the
 * "hint" computation: SHA-256(SHA-256(secret) as hex).
 */
async function sha256OfHex(hex: string): Promise<string> {
  return sha256Hex(hex)
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
  const hintToMatch = await sha256OfHex(fullHash)

  const res = await fetch(`${HMSL_BASE}/v1/prefix/${prefix}`, {
    method: 'GET',
    headers: {
      'GGShield-Token': apiKey,
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

  const body = (await res.json().catch(() => ({}))) as HmslResponse
  const matches = body.matches ?? []
  const leaked = matches.some((m) => m.hint === hintToMatch)

  return {
    leaked,
    details: {
      prefix,
      // Don't store hintToMatch or fullHash — those would let a malicious
      // DB reader replay the lookup to confirm what specific key leaked.
      candidates_for_prefix: matches.length,
      // payload presence indicates a verifiable leak record exists upstream;
      // we record whether one was returned (yes/no) rather than the value.
      has_payload: matches.find((m) => m.hint === hintToMatch)?.payload !== undefined,
    },
  }
}
