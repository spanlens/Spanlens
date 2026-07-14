/**
 * Reproducible micro-benchmark for the synchronous CPU overhead the Spanlens
 * proxy adds to each request, on the client's response path.
 *
 * What this measures
 * ------------------
 * The proxy's own synchronous per-request work, using the REAL production
 * transform functions (`buildUpstreamHeaders` / `buildDownstreamHeaders` from
 * src/proxy/utils.ts) plus the request/response (de)serialization the handler
 * performs. This is the CPU the proxy spends between receiving a client request
 * and returning the client's response.
 *
 * What this deliberately excludes, and why
 * ----------------------------------------
 *  - Network time to the upstream provider (OpenAI/Anthropic/Gemini). That is
 *    the provider's latency, not ours, so a real fetch would only measure their
 *    round-trip. We substitute an in-process mock upstream (zero network).
 *  - The provider-key lookup (a Supabase round-trip). It runs concurrently with
 *    body parsing via Promise.all in the handler and is a database call, not
 *    proxy CPU; it is reported separately in production as part of
 *    `proxy_overhead_ms`.
 *  - Asynchronous logging (cost calc, PII masking, ClickHouse insert). It is
 *    dispatched with `fireAndForget` (waitUntil) AFTER the response is already
 *    returned to the client, so it does not sit on the response critical path.
 *    This is the core architectural reason proxy overhead stays low.
 *
 * So the number below is a conservative, controlled measurement of the
 * synchronous proxy CPU cost, not an end-to-end production latency figure.
 * Production percentiles are measured live via the `proxy_overhead_ms` column
 * on every logged request.
 *
 * Run:  pnpm --filter server exec tsx scripts/bench-proxy-overhead.ts
 */

import {
  buildUpstreamHeaders,
  buildDownstreamHeaders,
} from '../src/proxy/utils.js'

const WARMUP = 20_000
const ITERATIONS = 100_000

// A representative client request: a normal chat completion with the header
// mix the proxy actually sees (Spanlens key transport + internal x-spanlens-*
// metadata that must be stripped before forwarding upstream).
const REQUEST_BODY = JSON.stringify({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a helpful assistant that answers concisely.' },
    { role: 'user', content: 'Summarize the causes of the French Revolution in three sentences.' },
  ],
  temperature: 0.7,
  max_tokens: 512,
})

function makeIncomingHeaders(): Headers {
  return new Headers({
    'authorization': 'Bearer sl_live_0123456789abcdef0123456789abcdef',
    'content-type': 'application/json',
    'accept': 'application/json',
    'user-agent': 'openai-python/1.40.0',
    'x-spanlens-project': 'proj_1234',
    'x-spanlens-user': 'user_abcd',
    'x-spanlens-session': 'sess_efgh',
    'x-trace-id': '00000000-0000-4000-8000-000000000000',
  })
}

// A representative upstream response body (~1.3 KB) with gzip content-encoding
// and a stale content-length, so the header-strip path is exercised realistically.
const RESPONSE_BODY = JSON.stringify({
  id: 'chatcmpl-ABC123',
  object: 'chat.completion',
  created: 1_700_000_000,
  model: 'gpt-4o-mini-2024-07-18',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content:
          'The French Revolution was driven by severe fiscal crisis and widespread famine that fell hardest on the common people. Enlightenment ideas about liberty and equality eroded the legitimacy of absolute monarchy and the privileged estates. Political deadlock in the Estates-General finally tipped popular anger into open revolt.',
      },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 42, completion_tokens: 63, total_tokens: 105 },
})

function makeUpstreamResponseHeaders(): Headers {
  return new Headers({
    'content-type': 'application/json',
    'content-encoding': 'gzip',
    'content-length': '512',
    'transfer-encoding': 'chunked',
    'openai-model': 'gpt-4o-mini-2024-07-18',
    'x-request-id': 'req_abc123',
  })
}

/**
 * One request's synchronous proxy work, mirroring the non-streaming hot path
 * in src/proxy/openai.ts (lines ~110-217), minus the network fetch and the
 * fire-and-forget logging.
 */
function oneRequest(): number {
  // Request side: strip Spanlens/hop-by-hop headers, inject upstream auth.
  const incoming = makeIncomingHeaders()
  const upstreamHeaders = buildUpstreamHeaders(incoming, {
    Authorization: 'Bearer sk-real-provider-key-redacted',
    'Content-Type': 'application/json',
  })
  // Body is forwarded as-is for this payload; parse to mirror the handler
  // reading reqBodyJson for the security gate + logging base.
  const reqBodyJson = JSON.parse(REQUEST_BODY) as Record<string, unknown>

  // Response side (mock upstream — zero network): strip hop-by-hop/encoding
  // headers, read the body, parse usage, reconstruct the client response.
  const upstreamResHeaders = makeUpstreamResponseHeaders()
  const downstreamHeaders = buildDownstreamHeaders(upstreamResHeaders)
  const resBodyText = RESPONSE_BODY
  const resBodyJson = JSON.parse(resBodyText) as Record<string, unknown>
  const clientResponse = new Response(resBodyText, {
    status: 200,
    headers: downstreamHeaders,
  })

  // Touch the results so V8 cannot dead-code-eliminate the work.
  return (
    upstreamHeaders.get('authorization') === null ? 1 : 0
  ) +
    (reqBodyJson['model'] ? 0 : 1) +
    ((resBodyJson['id'] as string).length > 0 ? 0 : 1) +
    clientResponse.status - 200
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

function main(): void {
  let sink = 0
  for (let i = 0; i < WARMUP; i++) sink += oneRequest()

  const samplesNs: number[] = new Array(ITERATIONS)
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = process.hrtime.bigint()
    sink += oneRequest()
    const t1 = process.hrtime.bigint()
    samplesNs[i] = Number(t1 - t0)
  }

  samplesNs.sort((a, b) => a - b)
  const toMs = (ns: number): number => ns / 1_000_000
  const mean = samplesNs.reduce((a, b) => a + b, 0) / samplesNs.length

  const result = {
    iterations: ITERATIONS,
    warmup: WARMUP,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    unit: 'ms',
    synchronous_proxy_overhead: {
      p50: +toMs(percentile(samplesNs, 50)).toFixed(4),
      p95: +toMs(percentile(samplesNs, 95)).toFixed(4),
      p99: +toMs(percentile(samplesNs, 99)).toFixed(4),
      p999: +toMs(percentile(samplesNs, 99.9)).toFixed(4),
      mean: +toMs(mean).toFixed(4),
      max: +toMs(samplesNs[samplesNs.length - 1]).toFixed(4),
    },
  }

  // eslint-disable-next-line no-console -- benchmark reporting is the point of this script
  console.log(JSON.stringify(result, null, 2))
  // Guard against dead-code elimination of the whole loop.
  if (sink === Number.MAX_SAFE_INTEGER) console.log(sink)
}

main()
