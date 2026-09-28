import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  guardedLookup,
  isBlockedIPv4,
  isBlockedIPv6,
  SSRF_BLOCKED_CODE,
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

  // The WHATWG URL parser rewrites the dotted tail of a v4-mapped literal into
  // hex: new URL('https://[::ffff:169.254.169.254]/').hostname is
  // '[::ffff:a9fe:a9fe]'. A dotted-only check lets that form straight through,
  // and a literal IP never reaches a DNS lookup that could catch it later.
  test.each([
    ['::ffff:a9fe:a9fe', '169.254'], // IMDS
    ['::ffff:7f00:1', '127.0.0.0/8'], // loopback
    ['::ffff:a00:5', '10.0.0.0/8'], // RFC 1918
    ['0:0:0:0:0:ffff:c0a8:101', '192.168.0.0/16'], // uncompressed spelling
  ])('blocks hex-form v4-mapped %s', (ip, expectedRange) => {
    const r = isBlockedIPv6(ip)
    expect(r.blocked).toBe(true)
    expect(r.range).toContain(expectedRange)
  })

  test('allows hex-form v4-mapped public IP (::ffff:808:808 = 8.8.8.8)', () => {
    expect(isBlockedIPv6('::ffff:808:808').blocked).toBe(false)
  })

  test.each([
    ['::7f00:1', 'IPv4-compatible loopback'],
    ['::169.254.169.254', 'IPv4-compatible IMDS'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 prefix wrapping IMDS'],
    ['64:ff9b::10.0.0.1', 'NAT64 prefix wrapping RFC 1918'],
    ['fec0::1', 'deprecated site-local'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIPv6(ip).blocked).toBe(true)
  })

  test('allows NAT64 prefix wrapping a public IPv4 (64:ff9b::808:808)', () => {
    expect(isBlockedIPv6('64:ff9b::808:808').blocked).toBe(false)
  })

  test.each(['1:2:3:4:5:6:7:8:9', '1::2::3', 'gggg::1', '::ffff:999.1.1.1'])(
    'fails closed on malformed IPv6 %s',
    (ip) => {
      expect(isBlockedIPv6(ip).blocked).toBe(true)
    },
  )
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

  test('rejects v4-mapped IMDS literal the URL parser rewrites to hex', () => {
    const r = validateOutboundUrlSync('https://[::ffff:169.254.169.254]/latest/meta-data/')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('BLOCKED_IP')
  })

  test('rejects v4-mapped loopback literal ([::ffff:127.0.0.1])', () => {
    expect(validateOutboundUrlSync('https://[::ffff:127.0.0.1]:8080/').ok).toBe(false)
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

type LookupAnswer = { address: string; family: number }
type LookupCallback = (err: NodeJS.ErrnoException | null, addresses?: LookupAnswer[]) => void
const lookupMock = vi.fn<(host: string, options: object, cb: LookupCallback) => void>()

vi.mock('node:dns', () => ({
  promises: {
    resolve4: (host: string) => resolve4Mock(host),
    resolve6: (host: string) => resolve6Mock(host),
  },
  lookup: (host: string, options: object, cb: LookupCallback) => lookupMock(host, options, cb),
}))

beforeEach(() => {
  resolve4Mock.mockReset()
  resolve6Mock.mockReset()
  lookupMock.mockReset()
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

// --- Connect-time guard ----------------------------------------------------
//
// validateOutboundUrl answers "what does this hostname resolve to right now".
// The socket then resolves it again, and an attacker's DNS can give the second
// query a different answer (rebinding). guardedLookup is the lookup the socket
// itself uses, so what it checks is what gets connected to.

interface LookupResult {
  err: NodeJS.ErrnoException | null
  address: string | Array<{ address: string; family: number }>
  family: number | undefined
}

function runGuardedLookup(host: string, options: { all?: boolean } = {}): Promise<LookupResult> {
  return new Promise((resolve) => {
    guardedLookup(host, options, (err, address, family) => resolve({ err, address, family }))
  })
}

function answer(...addresses: LookupAnswer[]): void {
  lookupMock.mockImplementation((_host, _options, cb) => cb(null, addresses))
}

describe('guardedLookup — connect-time SSRF check', () => {
  test('public answer passes through in the all-addresses form Node uses by default', async () => {
    answer({ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 })

    const r = await runGuardedLookup('hooks.example.com', { all: true })
    expect(r.err).toBeNull()
    expect(r.address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ])
  })

  test('public answer passes through in the single-address form', async () => {
    answer({ address: '93.184.216.34', family: 4 })

    const r = await runGuardedLookup('hooks.example.com')
    expect(r.err).toBeNull()
    expect(r.address).toBe('93.184.216.34')
    expect(r.family).toBe(4)
  })

  test('always asks the resolver for every address, whatever the caller requested', async () => {
    answer({ address: '93.184.216.34', family: 4 })

    await runGuardedLookup('hooks.example.com')
    expect(lookupMock.mock.calls[0]?.[1]).toMatchObject({ all: true })
  })

  test.each([
    ['127.0.0.1', 4, '127.0.0.0/8'],
    ['169.254.169.254', 4, '169.254.0.0/16'],
    ['10.1.2.3', 4, '10.0.0.0/8'],
    ['::1', 6, '::1/128'],
    ['::ffff:169.254.169.254', 6, '169.254'],
  ])('rebinding to %s is refused before any socket opens', async (address, family, range) => {
    answer({ address, family })

    const r = await runGuardedLookup('rebind.attacker.example', { all: true })
    expect(r.err?.code).toBe(SSRF_BLOCKED_CODE)
    expect(r.err?.message).toContain('SSRF guard')
    expect(r.err?.message).toContain(range)
  })

  test('one private address in a round-robin answer blocks the whole lookup', async () => {
    answer({ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 })

    const r = await runGuardedLookup('rebind.attacker.example', { all: true })
    expect(r.err?.code).toBe(SSRF_BLOCKED_CODE)
  })

  test('resolver errors are passed through unchanged', async () => {
    const notFound = Object.assign(new Error('getaddrinfo ENOTFOUND nope.example'), {
      code: 'ENOTFOUND',
    })
    lookupMock.mockImplementation((_host, _options, cb) => cb(notFound))

    const r = await runGuardedLookup('nope.example', { all: true })
    expect(r.err).toBe(notFound)
  })

  test('an empty answer is an error, not a silent success', async () => {
    answer()

    const r = await runGuardedLookup('empty.example', { all: true })
    expect(r.err?.code).toBe('ENOTFOUND')
  })
})
