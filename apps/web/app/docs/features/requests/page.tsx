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
        <code>requests</code> table. <a href="/requests">/requests</a> is the viewer: filter, drill
        down, read the actual request and response bodies. This is the raw substrate every other
        feature (Traces, Anomalies, Savings, etc.) aggregates from.
      </p>

      <h2>Why it matters</h2>
      <p>
        Dashboards lie. Aggregates smooth over outliers. When something weird happens — a user
        reports a wrong answer, a cost spike is unaccounted for, a prompt injection got through —
        you want to see the <em>actual bytes that went out</em> and <em>came back</em>. Requests is
        that time machine.
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
            <td><code>flags</code></td>
            <td><a href="/docs/features/security">PII / injection flags</a> (JSONB array)</td>
          </tr>
          <tr>
            <td><code>created_at</code></td>
            <td>When the request arrived at our proxy</td>
          </tr>
        </tbody>
      </table>

      <h2>Dashboard</h2>

      <h3>List view</h3>
      <p>At <a href="/requests">/requests</a> you get a paginated table with filters:</p>
      <ul>
        <li>Provider / model</li>
        <li>Project</li>
        <li>Status code (200 / 4xx / 5xx)</li>
        <li>Date range</li>
        <li>Free-text search (matches request/response body)</li>
      </ul>

      <h3>Detail view</h3>
      <p>
        Click any row to open <code>/requests/[id]</code>. Shows:
      </p>
      <ul>
        <li>Complete request body (JSON-formatted, syntax highlighted)</li>
        <li>Complete response body (same)</li>
        <li>All metadata (tokens, cost, latency, flags)</li>
        <li>
          Link back to the parent span in <a href="/docs/features/traces">Traces</a> if the request
          was made inside an <code>observe()</code> wrapper
        </li>
      </ul>

      <h2>API</h2>

      <CodeBlock language="bash">{`# List (paginated, filterable)
GET /api/v1/requests?projectId=<uuid>&provider=openai&statusCode=200&limit=50&offset=0

# One request by id
GET /api/v1/requests/:id

# Stats (count / tokens / cost per provider/model, custom window)
GET /api/v1/stats?sinceHours=168&groupBy=model`}</CodeBlock>

      <h2>Privacy & retention</h2>
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
          organization. The <code>requests</code> table has Row Level Security enabled; even our
          own SQL queries from the web app use the anon key and must pass RLS.
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>10KB body cap is fixed.</strong> We&apos;re considering a &ldquo;full-body
          archive to S3&rdquo; opt-in for Enterprise customers. Not in launch scope.
        </li>
        <li>
          <strong>No full-text index.</strong> Search is <code>ilike</code> over body — fine up to
          a few million rows. Heavier scale needs a separate OLAP layer (ClickHouse is the likely
          path).
        </li>
        <li>
          <strong>No replay / re-run button.</strong> You can&apos;t click &ldquo;send this request
          again with a different model&rdquo; from the UI yet. Manual curl + tweak for now.
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
