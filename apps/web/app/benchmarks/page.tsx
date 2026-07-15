import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-jsonld'

export const metadata = {
  alternates: { canonical: '/benchmarks' },
  title: 'Proxy Overhead Benchmark · Spanlens',
  description:
    'How much latency does the Spanlens proxy add? A reproducible benchmark of the synchronous per-request overhead, the methodology behind it, and the command to run it yourself.',
}

const MEASURED_DATE = '2026-07-14'

// Numbers from apps/server/scripts/bench-proxy-overhead.ts, 100,000 warm
// iterations, Node 22 / x64. Re-run the script to reproduce.
const RESULTS = [
  { metric: 'Median (p50)', ms: '0.008 ms', us: '~8 µs' },
  { metric: 'p95', ms: '0.010 ms', us: '~10 µs' },
  { metric: 'p99', ms: '0.015 ms', us: '~15 µs' },
  { metric: 'Mean', ms: '0.008 ms', us: '~8 µs' },
]

export default function BenchmarksPage() {
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <MarketingNav />
      <BreadcrumbJsonLd trail={[{ name: 'Benchmarks', path: '/benchmarks' }]} />

      <main className="flex-1 max-w-3xl mx-auto px-6 py-12 prose prose-stone
        prose-headings:scroll-mt-20
        prose-a:text-accent prose-a:no-underline hover:prose-a:opacity-80">
        <h1>Proxy Overhead Benchmark</h1>
        <p className="text-sm text-muted-foreground">
          <strong>Last measured:</strong> {MEASURED_DATE}
        </p>

        <p>
          A proxy only earns its place if it stays out of the way. This page reports how
          much latency the Spanlens proxy adds to a request, explains exactly how that
          number is produced, and gives you the command to reproduce it. We would rather
          publish a benchmark you can run than a marketing figure you have to trust.
        </p>

        <h2 id="result">The result</h2>
        <p>
          Synchronous proxy overhead per request, measured over 100,000 warm iterations
          using the same header-transform functions that run in production:
        </p>
        <table>
          <thead>
            <tr>
              <th>Percentile</th>
              <th>Overhead</th>
              <th>Approx.</th>
            </tr>
          </thead>
          <tbody>
            {RESULTS.map((r) => (
              <tr key={r.metric}>
                <td>{r.metric}</td>
                <td>{r.ms}</td>
                <td>{r.us}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          The proxy&apos;s own synchronous work is on the order of <strong>microseconds</strong>,
          not milliseconds. The rest of a request&apos;s time is the upstream provider
          answering your call, which Spanlens does not change.
        </p>

        <h2 id="why">Why it is this small</h2>
        <p>
          The expensive part of observability, writing the request, computing cost, masking
          PII, and inserting the log row, does <strong>not</strong> happen while your caller
          waits. Spanlens streams the provider response straight back to the client and
          dispatches logging as a fire-and-forget task that runs after the response has
          already been returned. Logging is off the response critical path by design, so it
          cannot slow the caller down. If the logging pipeline is briefly unavailable, work
          is captured in a fallback queue and replayed later rather than blocking the
          request.
        </p>
        <p>
          What remains on the caller&apos;s path is the synchronous work measured above:
          stripping hop-by-hop and Spanlens-internal headers, attaching the upstream
          credential, and reconstructing the response. That is the number in the table.
        </p>

        <h2 id="methodology">Methodology</h2>
        <p>The benchmark imports the real production transform functions and exercises the
          non-streaming proxy hot path against an in-process mock upstream. It measures with
          nanosecond-resolution timers after a warmup, then reports sorted percentiles.</p>
        <p>To keep the number honest, it deliberately excludes three things and reports why:</p>
        <ul>
          <li>
            <strong>Network time to the provider</strong> is excluded. That is OpenAI,
            Anthropic, or Gemini answering your request, not Spanlens. Measuring a real
            fetch would only measure their latency.
          </li>
          <li>
            <strong>The provider-key lookup</strong> (a database round-trip) is excluded
            from this CPU figure. In production it runs concurrently with request parsing
            and is reported live as part of the request&apos;s <code>proxy_overhead_ms</code>.
          </li>
          <li>
            <strong>Asynchronous logging</strong> is excluded because it runs after the
            response is returned. Including it would misrepresent what the caller actually
            waits for.
          </li>
        </ul>
        <p>
          So this is a conservative, controlled measurement of synchronous proxy CPU cost,
          not an end-to-end latency claim. It was measured locally on Node 22; because the
          work is CPU-bound and small, results are broadly representative, and you can
          reproduce them on your own hardware.
        </p>

        <h2 id="reproduce">Reproduce it</h2>
        <p>
          The benchmark script is part of the open-source repository. Clone it and run:
        </p>
        <pre><code>pnpm --filter server exec tsx scripts/bench-proxy-overhead.ts</code></pre>
        <p>
          The script is at{' '}
          <a
            href="https://github.com/spanlens/Spanlens/blob/main/apps/server/scripts/bench-proxy-overhead.ts"
            target="_blank"
            rel="noopener noreferrer"
          >
            apps/server/scripts/bench-proxy-overhead.ts
          </a>
          . It prints JSON with the percentiles above. Your absolute numbers will vary with
          hardware; the order of magnitude, microseconds, should not.
        </p>

        <h2 id="production">Measured in production too</h2>
        <p>
          Every request Spanlens logs carries a <code>proxy_overhead_ms</code> value, so the
          overhead is observed on live traffic rather than only in a benchmark. If you
          self-host, the same field is available on your own requests. Read more about the
          request pipeline in the{' '}
          <Link href="/docs/production/reliability">reliability documentation</Link> and the{' '}
          <Link href="/agent-tracing">agent tracing overview</Link>.
        </p>
      </main>

      <Footer />
    </div>
  )
}
