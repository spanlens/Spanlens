import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Reliability · Spanlens Docs',
  description:
    'How Spanlens degrades during a partial outage, what the fallback queue does, and how to monitor the proxy from your side. Designed so the proxy never silently drops logs.',
  alternates: { canonical: '/docs/production/reliability' },
}

export default function ReliabilityDocs() {
  return (
    <div>
      <h1>Reliability</h1>
      <p className="lead">
        The Spanlens proxy sits in the critical path of your LLM calls. This page covers
        what we guarantee, what degrades when, and how to detect each failure mode from
        your side without waiting for our status page.
      </p>

      <h2>What the proxy is on the critical path for</h2>
      <p>
        The proxy passes your request to OpenAI / Anthropic / Gemini and streams the
        response back. Logging to ClickHouse happens <em>after</em> the response leaves
        for the client, via Vercel&apos;s <code>waitUntil()</code>. Concretely:
      </p>
      <ul>
        <li>
          <strong>Critical for your user-facing latency</strong>: proxy auth, provider key
          decrypt, upstream fetch, stream pump back to your client.
        </li>
        <li>
          <strong>Not critical for your user</strong>: writing the log row, computing
          cost, parsing usage. These happen after the bytes are on the wire.
        </li>
      </ul>
      <p>
        So even when ClickHouse is unhappy, your application keeps returning responses to
        end users. The visible symptom is missing rows in <a href="/requests">/requests</a>,
        not failed API calls.
      </p>

      <h2>Failure modes and what happens</h2>
      <table>
        <thead>
          <tr>
            <th>Failure</th>
            <th>End-user impact</th>
            <th>Dashboard impact</th>
            <th>Auto-recovery</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Upstream provider 5xx (OpenAI down)</td>
            <td>Same as direct call: the SDK surfaces the 5xx.</td>
            <td>Request still logged with the 5xx status_code.</td>
            <td>Provider SDKs retry by default.</td>
          </tr>
          <tr>
            <td>Provider 429 rate limit</td>
            <td>Same as direct call: 429 returned.</td>
            <td>Logged with status_code=429.</td>
            <td>Provider SDKs retry with backoff.</td>
          </tr>
          <tr>
            <td>Stream exceeds 290s budget</td>
            <td>Stream closes gracefully; client sees an end-of-stream without sentinel.</td>
            <td>Logged with <code>truncated: true</code>, partial response body kept.</td>
            <td>Use <code>stream: true</code> with smaller <code>max_tokens</code>, or self-host (no Vercel 300s limit).</td>
          </tr>
          <tr>
            <td>Non-streaming &gt; 35s</td>
            <td>504 returned.</td>
            <td>Logged with status_code=504.</td>
            <td>Switch to streaming; first byte still arrives in ~200ms.</td>
          </tr>
          <tr>
            <td>ClickHouse unreachable</td>
            <td>None. Response already streamed.</td>
            <td>Log row queued in Supabase <code>requests_fallback</code>.</td>
            <td>Cron drains the queue every 5 min once ClickHouse is healthy.</td>
          </tr>
          <tr>
            <td>Supabase Postgres down</td>
            <td>None for the proxy itself. /api/v1/* endpoints (dashboard, key management) return 5xx.</td>
            <td>Dashboard reads fail; proxy keeps logging to ClickHouse.</td>
            <td>Supabase managed availability (cloud) or your HA setup (self-host).</td>
          </tr>
          <tr>
            <td>Both ClickHouse and Supabase down</td>
            <td>None. Response already streamed.</td>
            <td>Log row LOST (no queue to land in).</td>
            <td>Manual replay impossible. Self-host with HA Postgres + ClickHouse to avoid.</td>
          </tr>
        </tbody>
      </table>

      <h2>The fallback queue</h2>
      <p>
        When ClickHouse insert throws, the logger catches it and INSERTs the row into a
        Supabase table named <code>requests_fallback</code>. A cron route{' '}
        <code>POST /cron/replay-fallback</code> runs every 5 minutes, pulls up to 50 rows
        from the queue, and tries to insert them into ClickHouse. Successful inserts are
        deleted from the queue; failed ones increment <code>retry_count</code> and stay
        queued.
      </p>
      <ul>
        <li><strong>Expiry</strong>: rows are dropped after 7 days or 100 retries, whichever comes first.</li>
        <li><strong>Ordering</strong>: queue is FIFO by <code>created_at</code>, not strict per-organization.</li>
        <li><strong>Duplicates</strong>: ClickHouse has no UNIQUE constraint on the requests table. Race conditions can produce duplicate rows. Trade-off is accepted today; we prefer to lose fewer rows than dedupe in the hot path.</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Source: <code>apps/server/src/lib/fallback-replay.ts</code> and{' '}
        <code>apps/server/src/lib/logger.ts</code>.
      </p>

      <h2>Health endpoints</h2>
      <p>
        Two endpoints, two purposes. Both are public; no auth required.
      </p>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Purpose</th>
            <th>Returns</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>GET /health</code></td>
            <td>Process liveness. Cheap; safe to poll every 10s.</td>
            <td><code>200</code> always (if process is up).</td>
          </tr>
          <tr>
            <td><code>GET /health/deep</code></td>
            <td>Component health. Pings ClickHouse, checks fallback queue size.</td>
            <td><code>200</code> if all healthy, <code>503</code> if ClickHouse is unreachable.</td>
          </tr>
        </tbody>
      </table>
      <p>Sample response from <code>/health/deep</code>:</p>
      <CodeBlock language="json">{`{
  "status": "ok",
  "timestamp": "2026-05-31T03:14:22.000Z",
  "clickhouse": { "ok": true, "latencyMs": 42 },
  "fallback": { "queue": 0 }
}`}</CodeBlock>
      <p>
        Monitor these from your own observability stack (Better Stack, UptimeRobot, Pingdom,
        Sentry Crons, anything that supports HTTP probes). We recommend two probes:
      </p>
      <ul>
        <li><code>GET /health</code> every 60s, alert if 2 consecutive failures.</li>
        <li><code>GET /health/deep</code> every 5 min, alert on 503 OR if <code>fallback.queue &gt; 1000</code> (queue not draining).</li>
      </ul>

      <h2>Status page</h2>
      <p>
        Public status: <a href="https://status.spanlens.io" rel="noopener noreferrer" target="_blank">status.spanlens.io</a>{' '}
        (when the service is down our marketing pages may be down too; bookmark this URL
        directly). Incidents are posted with a one-line summary within 15 minutes of
        first detection and updated until resolved.
      </p>
      <p>
        For real-time pages on critical work, subscribe to the status page RSS or set up
        your own probe against <code>/health/deep</code>. The status page lags real
        detection by minutes.
      </p>

      <h2>What you should do client-side</h2>

      <h3>Retry on 5xx and 429 from the proxy</h3>
      <p>
        The official OpenAI / Anthropic SDKs already do this. If you wrote a raw HTTP
        client, add at least 2 retries with exponential backoff on 5xx and 429.
      </p>

      <h3>Do not retry on 401 / 403 / 400</h3>
      <p>
        401 means your Spanlens key is wrong. 403 means the key lacks permission (e.g.
        wrong project). 400 typically means missing provider key for the requested
        provider. None of these benefit from a retry; surface to the user.
      </p>

      <h3>Tolerate missing logs</h3>
      <p>
        Your application code should not block waiting for a Spanlens log to appear. A
        request returns to the user before the log is written; downstream features that
        depend on the log (e.g. real-time cost display) should poll with a small delay or
        accept eventual consistency.
      </p>

      <h3>Self-host if data residency matters more than ops effort</h3>
      <p>
        Self-hosting removes our cloud as a failure mode entirely. You take on running
        Postgres + ClickHouse, but the latency budget shifts entirely under your control.
        See <a href="/docs/self-host">Self-hosting</a>.
      </p>

      <h2>Incident response checklist</h2>
      <p>If you see missing rows in <a href="/requests">/requests</a>:</p>
      <ol>
        <li>Check <a href="https://status.spanlens.io" rel="noopener noreferrer" target="_blank">status.spanlens.io</a>.</li>
        <li>
          <code>curl https://server.spanlens.io/health/deep</code>. If <code>fallback.queue &gt; 0</code>,
          the rows are queued and will replay automatically; no action needed.
        </li>
        <li>
          Verify your application is hitting the proxy (Network tab in the browser, or
          your APM trace). If requests are not reaching <code>server.spanlens.io</code>,
          the gap is on your side.
        </li>
        <li>
          If status page is green AND <code>/health/deep</code> returns 200 AND your
          requests are reaching us, email <a href="mailto:support@spanlens.io">support@spanlens.io</a>{' '}
          with the request id (<code>x-spanlens-request-id</code> response header) and
          we will trace the missing row.
        </li>
      </ol>

      <h2>SLOs (cloud, hobby and paid)</h2>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Target</th>
            <th>How measured</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Proxy availability</td>
            <td>99.9% monthly</td>
            <td><code>GET /health</code> success rate from external probe.</td>
          </tr>
          <tr>
            <td>Logging completeness</td>
            <td>99.95% of calls eventually logged</td>
            <td>Compared against upstream provider invoice token counts daily.</td>
          </tr>
          <tr>
            <td>Proxy overhead (p95)</td>
            <td>&lt; 50 ms</td>
            <td><code>proxy_overhead_ms</code> column on every Request row.</td>
          </tr>
          <tr>
            <td>Fallback drain (p95)</td>
            <td>&lt; 15 min after ClickHouse recovers</td>
            <td>Time between queue size peak and queue size 0.</td>
          </tr>
        </tbody>
      </table>
      <p className="text-sm text-muted-foreground">
        Targets above are for the cloud product. Self-host SLOs are whatever you achieve;
        the code is the same.
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/production/scaling">scaling for high throughput</a>.
      </p>
    </div>
  )
}
