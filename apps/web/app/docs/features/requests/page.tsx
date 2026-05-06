import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Requests · Spanlens Docs',
  description:
    'Complete log of every LLM call routed through Spanlens — model, tokens, cost, latency, full request/response bodies.',
}

export default function RequestsDocs() {
  return (
    <div>
      <h1>Requests</h1>
      <p className="lead">
        Every LLM call that flows through the Spanlens proxy produces one row in the{' '}
        <code>requests</code> table. <a href="/requests">/requests</a> is the viewer: filter, sort,
        drill down, and read the actual request and response bodies. This is the raw substrate every
        other feature (Traces, Anomalies, Savings, etc.) aggregates from.
      </p>

      <h2>Why it matters</h2>
      <p>
        Aggregate views summarize — they smooth over individual outliers. When something goes wrong
        — a user reports a wrong answer, a cost spike is unaccounted for, a prompt injection slips
        through — you need to see the <em>actual bytes that went out</em> and{' '}
        <em>came back</em>. Requests gives you that exact record.
      </p>

      <h2>What gets logged</h2>
      <p>For every proxied call, Spanlens stores:</p>
      <table>
        <thead>
          <tr><th>Field</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>provider</code></td>
            <td>openai / anthropic / gemini</td>
          </tr>
          <tr>
            <td><code>model</code></td>
            <td>
              The dated variant returned by the provider (e.g.{' '}
              <code>gpt-4o-mini-2024-07-18</code>), not the alias you requested
            </td>
          </tr>
          <tr>
            <td><code>prompt_tokens</code> / <code>completion_tokens</code> / <code>total_tokens</code></td>
            <td>Parsed from the provider&apos;s response (or streamed deltas)</td>
          </tr>
          <tr>
            <td><code>cost_usd</code></td>
            <td>Computed via <a href="/docs/features/cost-tracking">cost tracking</a></td>
          </tr>
          <tr>
            <td><code>latency_ms</code></td>
            <td>Time from our proxy receiving the request to last byte sent</td>
          </tr>
          <tr>
            <td><code>status_code</code></td>
            <td>HTTP status from the provider (200, 429, 500, etc.)</td>
          </tr>
          <tr>
            <td><code>request_body</code> / <code>response_body</code></td>
            <td>
              Full payloads up to 10KB each. Truncated with a marker if larger. Authorization
              headers stripped before storage.
            </td>
          </tr>
          <tr>
            <td><code>project_id</code></td>
            <td>Scoped to the API key used (or <code>X-Spanlens-Project</code> header)</td>
          </tr>
          <tr>
            <td><code>provider_key_id</code></td>
            <td>Which provider key was used to make the call (name shown in the drawer)</td>
          </tr>
          <tr>
            <td><code>trace_id</code> / <code>span_id</code></td>
            <td>
              Set when the call was made inside an SDK <code>observe()</code> wrapper. Links to the
              parent <a href="/docs/features/traces">Trace</a>.
            </td>
          </tr>
          <tr>
            <td><code>flags</code></td>
            <td><a href="/docs/features/security">PII / injection flags</a> (JSONB array)</td>
          </tr>
          <tr>
            <td><code>created_at</code></td>
            <td>When the request arrived at the proxy</td>
          </tr>
        </tbody>
      </table>

      <h2>Dashboard</h2>

      <h3>Stat strip</h3>
      <p>
        Above the list, a five-cell strip shows real-time 24-hour metrics: total requests, average
        latency, spend, error rate, and active anomaly count. Each cell includes a mini spark chart.
        Cells turn accent-colored when a metric exceeds a threshold (latency &gt; 1 s, error rate
        &gt; 1%, any anomaly present).
      </p>

      <h3>Traffic bars</h3>
      <p>
        A 30-day bar chart sits below the stat strip. Bar height corresponds to request volume;
        bars with at least one error flip to the error color. Hover a bar to see the date label.
      </p>

      <h3>List view &amp; filters</h3>
      <p>
        The list auto-refreshes every 10 seconds so new requests appear without a page reload. A
        manual <em>↻</em> button in the toolbar forces an immediate refetch.
      </p>
      <p>The main table is paginated (up to 100 rows/page) with these filters:</p>
      <ul>
        <li><strong>Provider</strong> — exact match (openai / anthropic / gemini)</li>
        <li>
          <strong>Model</strong> — partial, case-insensitive match (e.g. searching &ldquo;mini&rdquo;
          matches <code>gpt-4o-mini-2024-07-18</code>)
        </li>
        <li><strong>Provider key</strong> — dropdown of your registered keys, to isolate traffic by key</li>
        <li><strong>Status</strong> — All / OK (2xx) / 4xx / 5xx</li>
        <li><strong>Date range</strong> — from / to</li>
      </ul>
      <p>
        Column headers for <strong>Latency</strong>, <strong>Cost</strong>,{' '}
        <strong>Tokens</strong>, and <strong>Age</strong> are clickable to sort ascending or
        descending. The default sort is newest-first by created_at.
      </p>
      <p>
        Hovering the <strong>Age</strong> cell shows a tooltip with the full timestamp.
      </p>

      <h3>Replay</h3>
      <p>
        Every request detail page has a <strong>Replay</strong> button. It opens a modal where you
        can re-run the original call against a different model and compare the result inline —
        without touching your application code.
      </p>
      <ul>
        <li>
          <strong>Model selector.</strong> A dropdown pre-populated with models for the same
          provider. The original model is always available as the first option. Changing the model
          resets any previous result.
        </li>
        <li>
          <strong>Run.</strong> Executes the replay server-side via{' '}
          <code>POST /api/v1/requests/:id/replay/run</code>. Spanlens decrypts your provider key,
          strips any <code>stream: true</code> flag, forwards the original request body with the
          new model, and returns a result card showing latency, token counts, and cost. The replayed
          call is also logged as a new row in <a href="/requests">/requests</a>.
        </li>
        <li>
          <strong>Copy curl.</strong> Fetches a ready-to-run <code>curl</code> snippet from{' '}
          <code>POST /api/v1/requests/:id/replay</code> and copies it to the clipboard. The snippet
          is also displayed in the modal so you can inspect or edit it before running.
        </li>
      </ul>

      <h3>Detail drawer</h3>
      <p>
        Clicking any row opens a 480 px right-side drawer — no page navigation. The drawer shows:
      </p>
      <ul>
        <li>Request ID, timestamp, and error badge (if applicable)</li>
        <li>Metadata grid: Model, Provider, Status code, Provider key name, Prompt tokens, Completion tokens</li>
        <li>
          Trace / Span IDs with inline links and copy buttons. Trace ID links directly to the{' '}
          <a href="/docs/features/traces">Traces</a> waterfall view.
        </li>
        <li>Metrics row: Latency, Cost, Total tokens (with prompt / completion breakdown)</li>
        <li>
          <strong>Prev / Next</strong> navigation buttons — step through the current result set one
          row at a time. When you reach the end of a page the drawer automatically loads the next
          page and jumps to the first (or last) row. An <em>Open →</em> link opens the standalone
          detail page <code>/requests/[id]</code> if you need a shareable URL.
        </li>
      </ul>

      <h4>Drawer tabs</h4>
      <table>
        <thead>
          <tr><th>Tab</th><th>Content</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Request</strong></td>
            <td>
              Formatted message view. OpenAI and Anthropic <code>messages[]</code> are rendered as
              a conversation. Anthropic <code>system</code> strings/arrays are shown in a separate
              block above the messages. Gemini <code>contents[].parts[]</code> are normalized into
              the same layout. A copy button exports the raw JSON.
            </td>
          </tr>
          <tr>
            <td><strong>Response</strong></td>
            <td>
              Response body JSON when captured. Streaming responses are not buffered server-side
              (they pass through directly to your app), so this tab shows a note in that case.
            </td>
          </tr>
          <tr>
            <td><strong>Trace</strong></td>
            <td>
              Mini span list from the parent trace (up to 8 spans with type badges and durations) +
              a link to open the full waterfall. Shows a help note when the request has no
              associated trace.
            </td>
          </tr>
          <tr>
            <td><strong>Raw</strong></td>
            <td>
              Full <code>request_body</code> and <code>response_body</code> as pretty-printed JSON,
              each with a copy button.
            </td>
          </tr>
          <tr>
            <td><strong>Error</strong></td>
            <td>
              Conditionally shown when <code>error_message</code> is set. Displays the raw error
              string from the provider.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>API</h2>

      <CodeBlock language="bash">{`# List requests — paginated, sortable, filterable
GET /api/v1/requests
  ?projectId=<uuid>      # filter by project
  &provider=openai       # exact match
  &model=mini            # partial match (case-insensitive)
  &providerKeyId=<uuid>  # filter by provider key
  &status=ok             # ok | 4xx | 5xx
  &from=2024-01-01T00:00:00Z
  &to=2024-01-31T23:59:59Z
  &sortBy=latency_ms     # created_at | latency_ms | cost_usd | total_tokens
  &sortDir=desc          # asc | desc
  &page=1
  &limit=50              # max 100

# One request by id (includes full request_body + response_body)
GET /api/v1/requests/:id

# Replay — curl snippet (proxy-ready payload)
POST /api/v1/requests/:id/replay
  Body: { "model": "gpt-4o-mini" }  # optional model override

# Replay — execute server-side and return result (latency / tokens / cost)
POST /api/v1/requests/:id/replay/run
  Body: { "model": "gpt-4o-mini" }  # optional model override`}</CodeBlock>

      <p>
        The list endpoint returns <code>{'{ success, data, meta: { total, page, limit } }'}</code>.
        Each row includes a flattened <code>provider_key_name</code> field (the human-readable key
        label) so the dashboard can render it without a second round-trip.
      </p>

      <h2>Privacy &amp; retention</h2>
      <ul>
        <li>
          <strong>Authorization headers are stripped</strong> from <code>request_body</code> before
          it&apos;s stored — your OpenAI/Anthropic/Gemini key never appears in logs.
        </li>
        <li>
          <strong>10KB body cap.</strong> Large prompts (e.g. 40-page PDF extraction) are truncated
          at 10KB with a visible marker. Full bodies would blow up storage and cost.
        </li>
        <li>
          <strong>Retention policy.</strong> Free plan: 7 days. Paid plans: 30/90 days. Old rows
          are pruned nightly by <code>cron-prune-logs</code>.
        </li>
        <li>
          <strong>RLS-enforced.</strong> You can only see requests belonging to your own
          organization. The <code>requests</code> table has Row Level Security enabled.
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>10KB body cap is fixed.</strong> A &ldquo;full-body archive to S3&rdquo; opt-in
          for Enterprise customers is on the roadmap.
        </li>
        <li>
          <strong>No full-text body search in the UI.</strong> The model filter uses{' '}
          <code>ilike</code>; there is no free-text search over request/response body content.
          Heavier search needs a separate OLAP layer (ClickHouse is the likely path).
        </li>
        <li>
          <strong>Streaming response bodies not captured.</strong> The proxy streams responses
          directly to your application without buffering, so <code>response_body</code> is{' '}
          <code>null</code> for streaming calls. Token counts and cost are still accurate (parsed
          from SSE deltas).
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/traces">Traces</a> (grouped view),{' '}
        <a href="/docs/features/cost-tracking">Cost tracking</a>,{' '}
        <a href="/docs/features/security">Security flags</a>,{' '}
        <a href="/requests">/requests</a> dashboard.
      </p>
    </div>
  )
}
