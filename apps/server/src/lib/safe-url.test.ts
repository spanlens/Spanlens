import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  isBlockedIPv4,
  isBlockedIPv6,
  validateOutboundUrlSync,
  validateOutboundUrl,
} from './safe-url.js'

/**
 * SSRF (Server-Side Request Forgery) defense suite. Each test maps to a
 * documented exploit pattern — if a check regresses, the matching test
 * fails with the original threat in its description.
 *
 * Reference incidents:
 *   - Capital One 2019: AWS IMDS at 169.254.169.254 → IAM credential theft
 *   - GCP metadata at metadata.google.internal / 169.254.169.254
 *   - DNS rebinding: hostname flips from public IP to private IP between
 *     registration and use → caught by phase-2 dispatch-time check, here
 *     covered by the BLOCKED_HOSTNAMES path.
 */

describe('isBlockedIPv4 — CIDR ranges', () => {
  test.each([
    ['10.0.0.1', '10.0.0.0/8'],         // RFC 1918 private
    ['10.255.255.255', '10.0.0.0/8'],
    ['127.0.0.1', '127.0.0.0/8'],       // loopback
    ['127.99.99.99', '127.0.0.0/8'],
    ['169.254.169.254', '169.254.0.0/16'], // AWS IMDS — Capital One
    ['169.254.0.1', '169.254.0.0/16'],
    ['172.16.0.1', '172.16.0.0/12'],    // RFC 1918 private
    ['172.31.255.255', '172.16.0.0/12'],
    ['192.168.1.1', '192.168.0.0/16'],  // RFC 1918 private (home routers)
    ['100.64.0.1', '100.64.0.0/10'],    // CGNAT
    ['0.0.0.0', '0.0.0.0/8'],
    ['224.0.0.1', '224.0.0.0/4'],       // multicast
    // 255.255.255.255 (broadcast) is also covered by the 240.0.0.0/4 reserved
    // range, which the blocklist scans first — assertion targets that label.
    ['255.255.255.255', '240.0.0.0/4'],
  ])('blocks %s as %s', (ip, expectedRange) => {
    const r = isBlockedIPv4(ip)
    expect(r.blocked).toBe(true)
    expect(r.range).toBe(expectedRange)
  })

  test.each([
    '8.8.8.8',         // public Google DNS
    '1.1.1.1',         // public Cloudflare DNS
    '172.15.255.255',  // just outside 172.16.0.0/12
    '172.32.0.1',      // just outside 172.16.0.0/12 high
    '169.253.255.255', // just outside 169.254/16
    '169.255.0.0',     // just outside 169.254/16
    '11.0.0.1',        // just outside 10/8
    '99.99.99.99',     // outside CGNAT
    '128.0.0.1',       // just outside 127/8
  ])('allows public IP %s', (ip) => {
    expect(isBlockedIPv4(ip).blocked).toBe(false)
  })

  test('rejects malformed IP as blocked (fail closed)', () => {
    expect(isBlockedIPv4('not.an.ip.address').blocked).toBe(true)
    expect(isBlockedIPv4('999.999.999.999').blocked).toBe(true)
    expect(isBlockedIPv4('10.0.0').blocked).toBe(true)
  })

  test('rejects leading-zero octets (octal-interpretation smuggling)', () => {
    // Some OS resolvers read "010" as octal 8, so attackers could pass
    // "010.0.0.1" to dodge a string-prefix block. We reject the form outright.
    expect(isBlockedIPv4('010.0.0.1').blocked).toBe(true)
  })
})

describe('isBlockedIPv6 — special ranges', () => {
  test.each([
    ['::1', '::1/128'],
    ['0:0:0:0:0:0:0:1', '::1/128'],
    ['fe80::1', 'fe80::/10'],         // link-local
    ['fc00::1', 'fc00::/7'],          // unique local (fc/fd prefix only)
    ['fd12:3456::1', 'fc00::/7'],
    ['ff02::1', 'ff00::/8'],          // multicast
  ])('blocks %s as %s', (ip, expectedRange) => {
    const r = isBlockedIPv6(ip)
    expect(r.blocked).toBe(true)
    expect(r.range).toBe(expectedRange)
  })

  test('blocks v4-mapped private IP (::ffff:169.254.169.254 = IMDS smuggle)', () => {
    // Without v4-mapped unwrap, a pure-v4 blocklist misses this form.
    const r = isBlockedIPv6('::ffff:169.254.169.254')
    expect(r.blocked).toBe(true)
    expect(r.range).toContain('169.254')
  })

  test('blocks v4-mapped loopback (::ffff:127.0.0.1)', () => {
    expect(isBlockedIPv6('::ffff:127.0.0.1').blocked).toBe(true)
  })

  test('allows public IPv6 (2001:4860:: Google DNS)', () => {
    expect(isBlockedIPv6('2001:4860:4860::8888').blocked).toBe(false)
  })

  test('allows v4-mapped public IP (::ffff:8.8.8.8)', () => {
    expect(isBlockedIPv6('::ffff:8.8.8.8').blocked).toBe(false)
  })
})

describe('validateOutboundUrlSync — format + scheme + hostname', () => {
  test('rejects empty / non-string input', () => {
    expect(validateOutboundUrlSync('').ok).toBe(false)
    expect(validateOutboundUrlSync(undefined as unknown as string).ok).toBe(false)
  })

  test('rejects malformed URL', () => {
    const r = validateOutboundUrlSync('not a url')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('INVALID_FORMAT')
  })

  test('rejects http:// (https only)', () => {
    const r = validateOutboundUrlSync('http://example.com/hook')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('INVALID_SCHEME')
  })

  test('rejects file:// and ftp://', () => {
    expect(validateOutboundUrlSync('file:///etc/passwd').ok).toBe(false)
    expect(validateOutboundUrlSync('ftp://internal.example.com/').ok).toBe(false)
  })

  test('rejects localhost hostname', () => {
    const r = validateOutboundUrlSync('https://localhost:8080/admin')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('BLOCKED_HOSTNAME')
  })

  test('rejects metadata.google.internal (case-insensitive)', () => {
    expect(validateOutboundUrlSync('https://metadata.google.internal/').ok).toBe(false)
    expect(validateOutboundUrlSync('https://Metadata.Google.Internal/').ok).toBe(false)
  })

  test('rejects literal IPv4 in private range without DNS', () => {
    const r = validateOutboundUrlSync('https://10.0.0.5/internal')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('BLOCKED_IP')
  })

  test('rejects literal IMDS IPv4 (169.254.169.254)', () => {
    const r = validateOutboundUrlSync('https://169.254.169.254/latest/meta-data/')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('BLOCKED_IP')
      expect(r.message).toContain('169.254')
    }
  })

  test('rejects literal IPv6 loopback ([::1])', () => {
    expect(validateOutboundUrlSync('https://[::1]:8080/').ok).toBe(false)
  })

  test('accepts well-formed public https URL with hostname (DNS deferred)', () => {
    const r = validateOutboundUrlSync('https://hooks.example.com/webhook')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.resolvedIps).toEqual([])
  })

  test('accepts literal public IPv4 without DNS', () => {
    const r = validateOutboundUrlSync('https://8.8.8.8/')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.resolvedIps).toEqual(['8.8.8.8'])
  })

  test('does not suffix-match metadata.google.internal.example.com', () => {
    // BLOCKED_HOSTNAMES is exact match — this attacker-controlled lookalike
    // domain must pass the sync check (the DNS phase will catch it if it
    // resolves to a private IP).
    expect(validateOutboundUrlSync('https://metadata.google.internal.example.com/').ok).toBe(true)
  })
})

// --- DNS-aware phase: mock node:dns/promises -------------------------------

const resolve4Mock = vi.fn<(host: string) => Promise<string[]>>()
const resolve6Mock = vi.fn<(host: string) => Promise<string[]>>()

vi.mock('node:dns', () => ({
  promises: {
    resolve4: (host: string) => resolve4Mock(host),
    resolve6: (host: string) => resolve6Mock(host),
  },
}))

beforeEach(() => {
  resolve4Mock.mockReset()
  resolve6Mock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('validateOutboundUrl — DNS-aware (phase 2)', () => {
  test('hostname resolves to public IP → ok with both A + AAAA captured', async () => {
    resolve4Mock.mockResolvedValue(['8.8.8.8'])
    resolve6Mock.mockResolvedValue(['2001:4860:4860::8888'])

    const r = await validateOutboundUrl('https://hooks.example.com/x')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.resolvedIps).toContain('8.8.8.8')
      expect(r.resolvedIps).toContain('2001:4860:4860::8888')
    }
  })

  test('DNS rebinding: hostname resolves to 169.254.169.254 → BLOCKED_IP', async () => {
    // The classic SSRF-via-rebinding attack: registration-time the hostname
    // returned a public IP, but at dispatch time it returns IMDS. The
    // dispatch-time call into validateOutboundUrl catches this.
    resolve4Mock.mockResolvedValue(['169.254.169.254'])
    resolve6Mock.mockRejectedValue(new Error('no AAAA'))

    const r = await validateOutboundUrl('https://attacker.example.com/webhook')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('BLOCKED_IP')
      expect(r.message).toContain('169.254')
    }
  })

  test('hostname resolves to a mix of public and private IPs → BLOCKED (any-private wins)', async () => {
    // Round-robin DNS that puts one private IP in the answer set is just as
    // dangerous as an all-private answer — the next connection may land on it.
    resolve4Mock.mockResolvedValue(['8.8.8.8', '10.0.0.1'])
    resolve6Mock.mockRejectedValue(new Error('no AAAA'))

    const r = await validateOutboundUrl('https://attacker.example.com/')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('BLOCKED_IP')
  })

  test('IPv6 resolves to v4-mapped private (::ffff:127.0.0.1) → BLOCKED', async () => {
    resolve4Mock.mockRejectedValue(new Error('no A'))
    resolve6Mock.mockResolvedValue(['::ffff:127.0.0.1'])

    const r = await validateOutboundUrl('https://attacker.example.com/')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('BLOCKED_IP')
  })

  test('DNS resolution fails for both families → DNS_FAILED', async () => {
    resolve4Mock.mockRejectedValue(new Error('NXDOMAIN'))
    resolve6Mock.mockRejectedValue(new Error('NXDOMAIN'))

    const r = await validateOutboundUrl('https://does-not-exist.example.com/')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('DNS_FAILED')
  })

  test('sync phase rejection short-circuits before DNS is consulted', async () => {
    const r = await validateOutboundUrl('http://example.com/')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('INVALID_SCHEME')
    expect(resolve4Mock).not.toHaveBeenCalled()
    expect(resolve6Mock).not.toHaveBeenCalled()
  })

  test('literal IP host bypasses DNS (sync phase decision is authoritative)', async () => {
    const r = await validateOutboundUrl('https://8.8.8.8/')
    expect(r.ok).toBe(true)
    expect(resolve4Mock).not.toHaveBeenCalled()
    expect(resolve6Mock).not.toHaveBeenCalled()
  })

  test('hostname resolves only via IPv6 (AAAA only) is supported', async () => {
    resolve4Mock.mockRejectedValue(new Error('no A record'))
    resolve6Mock.mockResolvedValue(['2606:4700:4700::1111'])

    const r = await validateOutboundUrl('https://v6-only.example.com/')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.resolvedIps).toEqual(['2606:4700:4700::1111'])
  })
})
