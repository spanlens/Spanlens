/**
 * SSRF (Server-Side Request Forgery) defense for outbound URLs.
 *
 * Spanlens stores user-supplied URLs in two paths:
 *   - api/webhooks.ts — customer registers a webhook target
 *   - lib/webhook-dispatch.ts — outbound POST fires that URL on every event
 *
 * Without validation, an attacker can register a URL pointing at an internal
 * service (loopback, private IP, cloud metadata) and trick the Vercel/Fly
 * worker into hitting it on their behalf. The classic exploit is AWS IMDS at
 * 169.254.169.254 — Capital One 2019 lost 100M records to that exact pattern.
 *
 * Two phases of validation:
 *   1. `validateOutboundUrlSync` — format + scheme + hostname only. Fast,
 *      runs on the request-handling hot path (webhook CRUD).
 *   2. `validateOutboundUrl` — adds DNS resolution + per-IP CIDR check.
 *      MUST run again at dispatch time too, because the DNS answer for a
 *      hostname can flip between registration and use (DNS rebinding).
 *
 * The deny list covers RFC 1918 private ranges, loopback, link-local
 * (including 169.254 cloud-metadata), CGNAT, multicast, and the
 * IPv6 equivalents. v4-mapped-into-v6 (::ffff:10.0.0.1) is normalized
 * back to v4 before checking so attackers can't smuggle private IPs
 * through the v6 path.
 */

import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'

/** Reasons the URL was rejected. Used as the ApiError detail.code. */
export type SafeUrlReason =
  | 'INVALID_FORMAT'
  | 'INVALID_SCHEME'
  | 'BLOCKED_HOSTNAME'
  | 'BLOCKED_IP'
  | 'DNS_FAILED'

export type SafeUrlResult =
  | { ok: true; resolvedIps: string[] }
  | { ok: false; reason: SafeUrlReason; message: string }

/**
 * Hostnames that resolve to cloud-provider metadata services or are common
 * internal aliases. Even when DNS resolution lands somewhere harmless these
 * names indicate intent — a legitimate customer never points a webhook at
 * `metadata.google.internal`. Match is exact + case-insensitive, no suffix
 * match (otherwise `metadata.google.internal.example.com` would block).
 */
const BLOCKED_HOSTNAMES = new Set<string>([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  // AWS doesn't publish a hostname for IMDS, but customers sometimes alias it.
  'metadata.aws',
  'metadata.aws.internal',
  // Azure IMDS hostname
  'metadata.azure.internal',
])

/** Returns a 32-bit unsigned integer for a dotted-quad IPv4 string, or null if malformed. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
    // Avoid `'01'` being read as octal — we already coerced via Number(),
    // but reject strings with leading zeros that an OS might interpret
    // as octal (some C-flavored resolvers still do).
    if (part.length > 1 && part.startsWith('0')) return null
    n = (n << 8) | octet
  }
  // Force unsigned interpretation (>>> 0).
  return n >>> 0
}

/** [networkInt, prefixLen] for each blocked IPv4 range. */
const BLOCKED_IPV4: Array<{ net: number; prefix: number; label: string }> = [
  // 0.0.0.0/8 — "this network", non-routable
  { net: ipv4ToInt('0.0.0.0')!,       prefix: 8,  label: '0.0.0.0/8' },
  // 10.0.0.0/8 — RFC 1918 private
  { net: ipv4ToInt('10.0.0.0')!,      prefix: 8,  label: '10.0.0.0/8' },
  // 100.64.0.0/10 — CGNAT (RFC 6598). Often used inside hyperscaler VPCs.
  { net: ipv4ToInt('100.64.0.0')!,    prefix: 10, label: '100.64.0.0/10' },
  // 127.0.0.0/8 — loopback
  { net: ipv4ToInt('127.0.0.0')!,     prefix: 8,  label: '127.0.0.0/8' },
  // 169.254.0.0/16 — link-local. Contains AWS IMDS (169.254.169.254).
  { net: ipv4ToInt('169.254.0.0')!,   prefix: 16, label: '169.254.0.0/16' },
  // 172.16.0.0/12 — RFC 1918 private
  { net: ipv4ToInt('172.16.0.0')!,    prefix: 12, label: '172.16.0.0/12' },
  // 192.0.0.0/24 — IETF protocol assignments
  { net: ipv4ToInt('192.0.0.0')!,     prefix: 24, label: '192.0.0.0/24' },
  // 192.0.2.0/24 — TEST-NET-1 (documentation)
  { net: ipv4ToInt('192.0.2.0')!,     prefix: 24, label: '192.0.2.0/24' },
  // 192.168.0.0/16 — RFC 1918 private
  { net: ipv4ToInt('192.168.0.0')!,   prefix: 16, label: '192.168.0.0/16' },
  // 198.18.0.0/15 — benchmark testing
  { net: ipv4ToInt('198.18.0.0')!,    prefix: 15, label: '198.18.0.0/15' },
  // 198.51.100.0/24 — TEST-NET-2
  { net: ipv4ToInt('198.51.100.0')!,  prefix: 24, label: '198.51.100.0/24' },
  // 203.0.113.0/24 — TEST-NET-3
  { net: ipv4ToInt('203.0.113.0')!,   prefix: 24, label: '203.0.113.0/24' },
  // 224.0.0.0/4 — multicast
  { net: ipv4ToInt('224.0.0.0')!,     prefix: 4,  label: '224.0.0.0/4' },
  // 240.0.0.0/4 — reserved
  { net: ipv4ToInt('240.0.0.0')!,     prefix: 4,  label: '240.0.0.0/4' },
  // 255.255.255.255 — broadcast
  { net: ipv4ToInt('255.255.255.255')!, prefix: 32, label: '255.255.255.255/32' },
]

/** True if the given dotted-quad IPv4 is inside any blocked CIDR. */
export function isBlockedIPv4(ip: string): { blocked: boolean; range?: string } {
  const int = ipv4ToInt(ip)
  if (int === null) return { blocked: true, range: 'malformed' }
  for (const { net, prefix, label } of BLOCKED_IPV4) {
    // mask of `prefix` high bits set
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    if ((int & mask) === (net & mask)) {
      return { blocked: true, range: label }
    }
  }
  return { blocked: false }
}

/**
 * Normalize an IPv6 address to lowercase canonical form. Node's `dns.resolve6`
 * already returns canonical lowercase, but inputs we read from URLs may be
 * mixed case or include the optional `[...]` brackets — strip those first.
 */
function canonicalizeIPv6(raw: string): string {
  return raw.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
}

/**
 * True if the IPv6 address is loopback/link-local/unique-local/multicast,
 * OR if it's a v4-mapped (::ffff:a.b.c.d) form whose embedded v4 is blocked.
 * The v4-mapped check is the trap that catches attackers who pass
 * `::ffff:169.254.169.254` to evade a pure-v4 IMDS filter.
 */
export function isBlockedIPv6(raw: string): { blocked: boolean; range?: string } {
  const ip = canonicalizeIPv6(raw)

  // ::1 loopback
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return { blocked: true, range: '::1/128' }
  // :: unspecified
  if (ip === '::' || ip === '0:0:0:0:0:0:0:0') return { blocked: true, range: '::/128' }

  // v4-mapped: ::ffff:a.b.c.d  → unwrap and check as IPv4
  const v4mapped = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/i.exec(ip)
  if (v4mapped) {
    const v4 = v4mapped[1]!
    const v4Result = isBlockedIPv4(v4)
    if (v4Result.blocked) {
      return { blocked: true, range: `::ffff:${v4Result.range ?? v4}` }
    }
  }

  // fc00::/7 — unique local
  if (ip.startsWith('fc') || ip.startsWith('fd')) return { blocked: true, range: 'fc00::/7' }
  // fe80::/10 — link-local
  if (/^fe[89ab]/.test(ip)) return { blocked: true, range: 'fe80::/10' }
  // ff00::/8 — multicast
  if (ip.startsWith('ff')) return { blocked: true, range: 'ff00::/8' }

  return { blocked: false }
}

/**
 * Phase 1 validation: format + scheme + hostname only. No DNS.
 *
 * Use at registration time to give the customer fast feedback. Always pair
 * with `validateOutboundUrl` at dispatch time — phase 1 cannot stop a
 * hostname that resolves to a private IP, only obviously-bad inputs.
 */
export function validateOutboundUrlSync(raw: string): SafeUrlResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'INVALID_FORMAT', message: 'url is required' }
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'INVALID_FORMAT', message: 'url is not a valid URL' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'INVALID_SCHEME', message: 'url must use https://' }
  }

  // Node's URL parser keeps the `[...]` brackets on IPv6 hostnames
  // (`new URL('https://[::1]/').hostname === '[::1]'`). Strip them so the
  // isIP / blocklist checks see the literal address.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return {
      ok: false,
      reason: 'BLOCKED_HOSTNAME',
      message: `url hostname "${hostname}" is not allowed (internal/metadata target)`,
    }
  }

  // If the hostname IS a literal IP, check it now without DNS.
  const ipKind = isIP(hostname)
  if (ipKind === 4) {
    const r = isBlockedIPv4(hostname)
    if (r.blocked) {
      return {
        ok: false,
        reason: 'BLOCKED_IP',
        message: `url resolves to a blocked IP range (${r.range ?? 'unknown'})`,
      }
    }
  } else if (ipKind === 6) {
    const r = isBlockedIPv6(hostname)
    if (r.blocked) {
      return {
        ok: false,
        reason: 'BLOCKED_IP',
        message: `url resolves to a blocked IPv6 range (${r.range ?? 'unknown'})`,
      }
    }
  }

  return { ok: true, resolvedIps: ipKind ? [hostname] : [] }
}

/**
 * Phase 2 validation: full check including DNS resolution.
 *
 * Resolves A + AAAA records for the hostname and rejects if ANY of them is in
 * a blocked range. Even one bad IP is enough — DNS round-robin would let an
 * attacker land on the bad one even if siblings look clean.
 *
 * `dns.resolve4/6` throws on NXDOMAIN; both throws are caught and surfaced
 * as DNS_FAILED so callers can distinguish "DNS broken" from "DNS clean but
 * landed on a private IP".
 */
export async function validateOutboundUrl(raw: string): Promise<SafeUrlResult> {
  const syncResult = validateOutboundUrlSync(raw)
  if (!syncResult.ok) return syncResult

  // Hostname was already a literal IP and passed phase 1 — done.
  if (syncResult.resolvedIps.length > 0) return syncResult

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'INVALID_FORMAT', message: 'url is not a valid URL' }
  }
  // Same bracket-strip rationale as the sync path.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')

  // Resolve both families in parallel; at least one must succeed.
  const [v4Settled, v6Settled] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ])

  const v4 = v4Settled.status === 'fulfilled' ? v4Settled.value : []
  const v6 = v6Settled.status === 'fulfilled' ? v6Settled.value : []

  if (v4.length === 0 && v6.length === 0) {
    return {
      ok: false,
      reason: 'DNS_FAILED',
      message: `url hostname "${hostname}" could not be resolved`,
    }
  }

  for (const ip of v4) {
    const r = isBlockedIPv4(ip)
    if (r.blocked) {
      return {
        ok: false,
        reason: 'BLOCKED_IP',
        message: `url resolves to a blocked IP range (${r.range ?? ip})`,
      }
    }
  }
  for (const ip of v6) {
    const r = isBlockedIPv6(ip)
    if (r.blocked) {
      return {
        ok: false,
        reason: 'BLOCKED_IP',
        message: `url resolves to a blocked IPv6 range (${r.range ?? ip})`,
      }
    }
  }

  return { ok: true, resolvedIps: [...v4, ...v6] }
}
