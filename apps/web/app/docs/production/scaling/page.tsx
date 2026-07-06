import { CodeBlock } from '../../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  title: 'Scaling · Spanlens Docs',
  description:
    'Latency budget, log body trade-offs, sampling, and self-hosting tuning for high-throughput LLM workloads on Spanlens.',
  alternates: { canonical: '/docs/production/scaling' },
}

export default function ScalingDocs() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Scaling</h1>
      <p className="lead">
        At small volume Spanlens runs at default settings without thought. Past a few
        requests per second you start hitting trade-offs between log fidelity, latency,
        and cost. This page is the explicit map of those trade-offs and the levers
        available.
      </p>

      <h2>Latency budget</h2>
      <table>
        <thead>
          <tr>
            <th>Step</th>
            <th>Typical</th>
            <th>p95</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>DNS + TLS handshake (first call)</td>
            <td>~80 ms</td>
            <td>~250 ms</td>
            <td>Amortized to ~0 ms for keep-alive connections.</td>
          </tr>
          <tr>
            <td>Auth (API key lookup)</td>
            <td>~5 ms</td>
            <td>~15 ms</td>
            <td>Hash + DB lookup, cached in-process per warm container.</td>
          </tr>
          <tr>
            <td>Provider key decrypt</td>
            <td>~2 ms</td>
            <td>~5 ms</td>
            <td>AES-256-GCM via Web Crypto.</td>
          </tr>
          <tr>
            <td>Upstream provider call</td>
            <td>varies</td>
            <td>varies</td>
            <td>This is your model latency. Spanlens does not add to it.</td>
          </tr>
          <tr>
            <td>Stream pump (per chunk)</td>
            <td>&lt; 1 ms</td>
            <td>~3 ms</td>
            <td>tee() into our log buffer, passthrough to client.</td>
          </tr>
          <tr>
            <td>Log write (async, off critical path)</td>
            <td>~30 ms</td>
            <td>~150 ms</td>
            <td>Runs after response leaves; does not delay your user.</td>
          </tr>
        </tbody>
      </table>
      <p>
        <strong>Bottom line:</strong> for warm connections the user-visible overhead is
        ~10 ms typical, ~50 ms p95. That number is recorded on every Request row in the
        <code>proxy_overhead_ms</code> column so you can audit it directly in{' '}
        <a href="/requests">/requests</a>.
      </p>

      <h2>Lever 1: log body mode</h2>
      <p>
        The biggest log size driver is the request and response body. By default we keep
        them fully. For high-throughput apps where bodies are large but you only need
        cost and trace structure, drop to <code>meta</code> or <code>none</code>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>request_body / response_body</th>
            <th>user_id / session_id</th>
            <th>When to use</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>full</code> (default)</td>
            <td>kept</td>
            <td>kept</td>
            <td>Most teams. Bodies are essential for debugging.</td>
          </tr>
          <tr>
            <td><code>meta</code></td>
            <td>empty string</td>
            <td>kept</td>
            <td>You only need cost / latency / token / user-level analytics.</td>
          </tr>
          <tr>
            <td><code>none</code></td>
            <td>empty string</td>
            <td>null</td>
            <td>Strict PII zones. You still get cost and structure, no identifying data.</td>
          </tr>
        </tbody>
      </table>
      <p>Set per-call via header or SDK helper:</p>
      <CodeBlock language="ts">{`import { createOpenAI, withLogBody } from '@spanlens/sdk/openai'

const openai = createOpenAI()

const res = await openai.chat.completions.create(
  { ... },
  { headers: withLogBody('meta').headers },
)`}</CodeBlock>
      <p>
        Or set process-wide via the SDK:
      </p>
      <CodeBlock language="ts">{`import { observeOpenAI } from '@spanlens/sdk/openai'

await observeOpenAI(openai, { logBody: 'meta' }, async () => { ... })`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        Storage impact: <code>full</code> mode adds ~2 KB per call (ZSTD compressed).
        <code>meta</code> mode is ~150 bytes per call. At 10M calls/month the difference
        is roughly 20 GB vs 1.5 GB of column-store space.
      </p>

      <h2>Lever 2: sampling</h2>
      <p>
        For very high volumes (10k+ rps), even compressed bodies add up. Sample at the
        SDK level:
      </p>
      <CodeBlock language="ts">{`import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI({
  sampling: {
    rate: 0.1,           // log 10% of calls
    alwaysLogErrors: true, // override sampling for status >= 400
  },
})`}</CodeBlock>
      <p>
        Sampled-out calls still flow through the proxy normally; they are just not
        persisted. Errors are always logged regardless of sample rate so debugging stays
        intact. Aggregate metrics (cost, latency) are scaled up by the inverse of the
        sample rate when displayed.
      </p>
      <p className="text-sm text-muted-foreground">
        Sampling is a per-call decision made before the request is sent. Use{' '}
        <code>alwaysLogErrors: true</code> to ensure you never miss a 5xx.
      </p>

      <h2>Lever 3: trace sampling</h2>
      <p>
        Traces are usually orders of magnitude lighter than request bodies, so most teams
        log every trace. If you need to sample, do it at the trace-creation site:
      </p>
      <CodeBlock language="ts">{`const shouldTrace = Math.random() < 0.2  // 20% sample
const trace = shouldTrace
  ? client.startTrace({ name: 'agent' })
  : null

// ... wrap observe() calls only if trace is non-null`}</CodeBlock>
      <p>
        Sampled-out traces simply do not exist. There is no per-span sampling; if a trace
        is on, all its spans are kept.
      </p>

      <h2>Lever 4: streaming for long generations</h2>
      <p>
        Anything that might exceed the 290s stream deadline (Vercel Pro cap) should use{' '}
        <code>stream: true</code>. The proxy streams chunks straight through; first byte
        arrives in ~200 ms regardless of total duration. If the stream does hit the
        deadline, the Request is logged with <code>truncated: true</code> and the partial
        response body is kept.
      </p>
      <p>
        For non-streaming requests, the upstream fetch is gated at <code>UPSTREAM_TIMEOUT_MS = 35000</code>{' '}
        for initial headers. Bigger jobs should use streaming, period.
      </p>

      <h2>Connection reuse</h2>
      <p>
        Most provider SDKs maintain an HTTPS keep-alive pool. Make sure yours does:
      </p>
      <ul>
        <li>OpenAI Node SDK: keep-alive on by default.</li>
        <li>Anthropic Node SDK: keep-alive on by default.</li>
        <li>Raw fetch: no keep-alive by default in some runtimes. In Node, use <code>undici</code>&apos;s default Agent.</li>
      </ul>
      <p>
        TLS handshake cost dominates first-call latency. With keep-alive, the per-call
        overhead drops to the &lt;15 ms numbers in the table above.
      </p>

      <h2>Concurrency on the proxy</h2>
      <p>
        Spanlens cloud runs on Vercel Pro with a per-region invocation pool. There is no
        per-account concurrency limit we enforce at the proxy layer; the upstream
        provider&apos;s rate limit is the real ceiling.
      </p>
      <p>
        If you are bursting hard enough to saturate Vercel&apos;s pool, you will see 503
        from the proxy. The provider SDKs retry these. For sustained high traffic, talk to
        us about a dedicated deployment, or self-host on infra you control.
      </p>

      <h2>Self-host tuning</h2>
      <p>
        When you self-host, the bottlenecks shift to your Postgres + ClickHouse setup.
        Defaults work for thousands of req/s on a single ClickHouse node; past that:
      </p>

      <h3>ClickHouse</h3>
      <ul>
        <li><strong>Partition by month is plenty</strong> up to ~100M rows per month per project.</li>
        <li><strong>ORDER BY (organization_id, project_id, created_at, id)</strong> is tuned for tenant-scoped time queries. Do not change without re-bench.</li>
        <li><strong>ZSTD(3)</strong> on bodies is the sweet spot. ZSTD(9) buys ~15% more compression at 2x more CPU.</li>
        <li><strong>Asynchronous inserts</strong> with <code>async_insert=1</code> reduces write amplification on bursty workloads. Trade-off: up to 1s additional log latency, no data loss.</li>
      </ul>

      <h3>Supabase Postgres</h3>
      <p>
        Postgres handles traces, spans, prompts, evals. None are append-only at the
        request volume; even at 1M traces/month one Supabase project handles it
        comfortably.
      </p>
      <ul>
        <li>RLS adds ~2 ms per query. Worth it for the multi-tenant isolation.</li>
        <li>
          <code>spans_refresh_trace_aggregates</code> trigger fires on every span
          INSERT / UPDATE. Heavy span churn on a single trace amplifies. If you measure
          this as a hotspot, switch to a periodic recompute.
        </li>
      </ul>

      <h3>Replay queue</h3>
      <p>
        The <code>requests_fallback</code> queue drains 50 rows per 5-minute cron tick by
        default (~10 rows/sec). For higher recovery throughput, change the cron schedule
        in <code>vercel.json</code> or run the replay handler as a long-lived worker
        instead.
      </p>

      <h2>What to monitor</h2>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Where</th>
            <th>Alert threshold</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>proxy_overhead_ms</code> p95</td>
            <td>aggregate <a href="/requests">/requests</a> column</td>
            <td>&gt; 80 ms for 10 minutes</td>
          </tr>
          <tr>
            <td>5xx rate</td>
            <td>group requests by status_code</td>
            <td>&gt; 1% for 5 minutes</td>
          </tr>
          <tr>
            <td>Fallback queue size</td>
            <td><code>GET /health/deep</code></td>
            <td>&gt; 1000 sustained for 30 min</td>
          </tr>
          <tr>
            <td>Truncated streams</td>
            <td>requests where <code>truncated=true</code></td>
            <td>&gt; 5% of streaming requests</td>
          </tr>
        </tbody>
      </table>

      <h2>Cost optimization tactics</h2>
      <ul>
        <li>
          <strong>Switch to <code>meta</code> for chatty internal services.</strong> A
          customer support bot that gets the same 50 messages over and over does not need
          bodies stored 50 times.
        </li>
        <li>
          <strong>Use sampling for high-volume embeddings.</strong> Embedding calls are
          often 100x more frequent than completions and contain less debugging value.
          Sample at 10% and you keep all the signal at 1/10 the storage.
        </li>
        <li>
          <strong>Self-host if you do millions of calls per day.</strong> Cloud
          pricing crosses over with self-host TCO somewhere around 10M calls/month for
          most teams.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/production/reliability">reliability</a> for failure modes
        and recovery, or <a href="/docs/self-host">self-hosting</a> for full control.
      </p>
    </div>
  )
}
