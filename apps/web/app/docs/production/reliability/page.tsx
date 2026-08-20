import { openGraphFor } from '@/lib/page-metadata'
import { CodeBlock } from '../../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  title: 'Reliability · Spanlens Docs',
  description:
    'How Spanlens degrades during a partial outage, what the fallback queue does, and how to monitor the proxy so it never silently drops logs.',
  alternates: { canonical: '/docs/production/reliability' },
  openGraph: openGraphFor('/docs/production/reliability'),
}

export default function ReliabilityDocs() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Reliability</h1>
      <p className="lead">
        The Spanlens proxy sits in the critical path of your LLM calls. This page covers
        what we guarantee, what degrades when, and how to detect each failure mode from
        your side without waiting for our status page.
      </p>

      <h2>What the proxy is on the critical path for</h2>
      <p>
        The proxy passes your request to OpenAI / Anthropic / Gemini and streams the
        response back. The log row is written <em>after</em> the response leaves for the
        client, via Vercel&apos;s <code>waitUntil()</code>. Concretely:
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
        So even when the database is unhappy, your application keeps returning responses to
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
            <td>The log insert fails (pooler saturated, statement timeout, schema behind the code)</td>
            <td>None. Response already streamed.</td>
            <td>Row queued in <code>requests_fallback</code>, so it shows up late.</td>
            <td>Cron drains the queue every 5 min once the insert path is healthy.</td>
          </tr>
          <tr>
            <td>Postgres unreachable</td>
            <td>Warm instances keep authenticating from their 30s key cache. After that, new calls fail closed.</td>
            <td>Dashboard reads fail. /api/v1/* returns 5xx.</td>
            <td>Supabase managed availability (cloud) or your HA setup (self-host).</td>
          </tr>
          <tr>
            <td>Postgres unreachable long enough for the queue to fill</td>
            <td>None for calls that already went through.</td>
            <td>Rows older than 7 days in the queue are dropped.</td>
            <td>None. Restore the database before the TTL expires.</td>
          </tr>
        </tbody>
      </table>

      <h2>The fallback queue</h2>
      <p>
        The log row goes in over the pooled connection. When that insert throws, the logger
        catches it and writes the row into a table named <code>requests_fallback</code>{' '}
        instead, over PostgREST. Same database, different route in, which is what makes it
        useful: the two paths fail for different reasons. An exhausted pooler, a statement
        timeout, or a column the deployed schema does not have yet stops the direct insert
        while PostgREST keeps working.
      </p>
      <p>
        A cron route, <code>GET /cron/replay-fallback</code>, runs every 5 minutes, pulls up
        to 50 rows in FIFO order, and inserts them into <code>requests</code> as one
        statement. Rows that land are deleted from the queue. Rows that do not get their{' '}
        <code>retry_count</code> bumped and stay put.
      </p>
      <ul>
        <li><strong>Expiry</strong>: rows are dropped after 7 days or 100 retries, whichever comes first.</li>
        <li><strong>Ordering</strong>: FIFO by <code>created_at</code>, not strict per-organization.</li>
        <li>
          <strong>Duplicates</strong>: the replay insert ends in{' '}
          <code>ON CONFLICT (created_at, id) DO NOTHING</code>. If a batch lands but the
          queue delete blips, the next run re-inserts nothing and the queue still drains. A
          replayed row cannot double-count against your cost or quota.
        </li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Source: <code>apps/server/src/lib/fallback-replay.ts</code> and{' '}
        <code>apps/server/src/lib/logger.ts</code>.
      </p>

      <h2>Health endpoints</h2>
      <p>
        Three endpoints, three depths. All are public; no auth required.
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
            <td><code>GET /health/ready</code></td>
            <td>
              Readiness. Pings the database both ways it is reached, PostgREST and the pooled
              connection, plus the rate-limit store. Cheap enough for a 30s container
              healthcheck.
            </td>
            <td><code>200</code> if all healthy, <code>503</code> if a dependency is unreachable.</td>
          </tr>
          <tr>
            <td><code>GET /health/deep</code></td>
            <td>
              Component view. Adds the fallback queue depth, the slowest cron run in 24h, and
              webhook backlog counts. Meant for a 5 minute probe, not a 30 second one.
            </td>
            <td><code>200</code> if the pooled connection answers, <code>503</code> if it does not.</td>
          </tr>
        </tbody>
      </table>
      <p>Sample response from <code>/health/deep</code>:</p>
      <CodeBlock language="json">{`{
  "status": "ok",
  "timestamp": "2026-08-20T03:14:22.000Z",
  "version": "a1b2c3d",
  "postgresPool": { "ok": true, "latencyMs": 12, "probedInMs": 41 },
  "fallback": { "queue": 0 },
  "crons": { "max_runtime_ms": 1840 },
  "webhooks": { "backlog_count": 0, "dlq_count": 0 }
}`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        A <code>null</code> anywhere in there means the lookup itself failed, not that the
        number is zero. Worth distinguishing when you triage.
      </p>
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
        directly). The page tracks the proxy (liveness + deep health) and the dashboard
        independently, and posts incident updates within 15 minutes of first detection.
      </p>
      <p>
        Subscribe by email or RSS directly on the status page (Subscribe button, top
        right). For real-time pages on critical work, set up your own probe against{' '}
        <code>/health/deep</code> as well, the status page lags real detection by
        minutes.
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
        Self-hosting removes our cloud as a failure mode entirely. You take on running one
        Postgres database, and the latency budget shifts under your control. See{' '}
        <a href="/docs/self-host">Self-hosting</a>.
      </p>

      <h2>Incident response checklist</h2>
      <p>If you see missing rows in <a href="/requests">/requests</a>:</p>
      <ol>
        <li>Check <a href="https://status.spanlens.io" rel="noopener noreferrer" target="_blank">status.spanlens.io</a>.</li>
        <li>
          <code>curl https://api.spanlens.io/health/deep</code>. If <code>fallback.queue &gt; 0</code>,
          the rows are queued and will replay automatically; no action needed.
        </li>
        <li>
          Verify your application is hitting the proxy (Network tab in the browser, or
          your APM trace). If requests are not reaching <code>api.spanlens.io</code>,
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
            <td>&lt; 15 min after the insert path recovers</td>
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
