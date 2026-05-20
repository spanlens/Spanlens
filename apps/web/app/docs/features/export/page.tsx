import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Data Export · Spanlens Docs',
  description:
    'Download request logs, traces, anomalies, and security flags as CSV, JSONL, or JSON to feed into BI tools or data pipelines. Streamed for million-row exports.',
}

export default function ExportDocs() {
  return (
    <div>
      <h1>Data Export</h1>
      <p className="lead">
        Download request logs, traces, anomaly snapshots, and security flags as CSV, JSONL, or JSON
        in one shot. CSV and JSONL stream directly from ClickHouse — a million-row export runs in
        ~30&nbsp;MB of memory and finishes inside the function-execution window. Connect to Pandas,
        BigQuery, Redash, Metabase, or your own pipeline.
      </p>

      <h2>Endpoints</h2>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>GET /api/v1/exports/requests</code></td>
            <td>Request logs — provider, model, tokens, cost, latency, etc.</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/exports/traces</code></td>
            <td>Traces — span count, total cost, duration, etc.</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/exports/anomalies</code></td>
            <td>Anomaly snapshots — daily history of buckets that exceeded 3σ</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/exports/security</code></td>
            <td>Security flags — PII detections and prompt injection hits</td>
          </tr>
        </tbody>
      </table>
      <p>
        All endpoints require <strong>JWT authentication</strong> (<code>authJwt</code> middleware).
        Include <code>Authorization: Bearer &lt;supabase_access_token&gt;</code> in the request header.
      </p>

      <h2>Common query parameters</h2>
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>format</code></td>
            <td><code>csv</code></td>
            <td>
              <code>csv</code> · <code>jsonl</code> · <code>json</code>. CSV and JSONL stream; JSON
              materialises a wrapper object. See <a href="#formats">Formats</a> below.
            </td>
          </tr>
          <tr>
            <td><code>from</code></td>
            <td>—</td>
            <td>
              ISO 8601 start time (e.g. <code>2026-05-01T00:00:00Z</code>). Defaults to 30 days
              ago if omitted.
            </td>
          </tr>
          <tr>
            <td><code>to</code></td>
            <td>—</td>
            <td>ISO 8601 end time. Defaults to now if omitted.</td>
          </tr>
          <tr>
            <td><code>limit</code></td>
            <td>format-dependent</td>
            <td>
              CSV / JSONL: 1 – <strong>1,000,000</strong>. JSON: 1 – 10,000.
              <code>/exports/requests</code> only — other endpoints stay at 10,000.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="formats">Formats — when to pick each</h2>
      <table>
        <thead>
          <tr>
            <th>Format</th>
            <th>Streamed?</th>
            <th>Row cap</th>
            <th>Best for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>csv</code></td>
            <td>Yes</td>
            <td>1,000,000</td>
            <td>BI tools, spreadsheets, ad-hoc analysis. Default.</td>
          </tr>
          <tr>
            <td><code>jsonl</code></td>
            <td>Yes</td>
            <td>1,000,000</td>
            <td>
              Pipelines that preserve typing (jq, <code>pandas.read_json(lines=True)</code>,
              BigQuery, ClickHouse). One JSON object per line, newline-delimited.
            </td>
          </tr>
          <tr>
            <td><code>json</code></td>
            <td>No — buffered</td>
            <td>10,000</td>
            <td>
              Wrapper object <code>{`{ exported_at, count, data: [...] }`}</code> for code that
              wants a single parseable response. Use <code>jsonl</code> for anything larger.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Streamed responses set <code>Cache-Control: no-store</code> so intermediaries don&apos;t
        buffer the full body. Each ClickHouse batch (~64&nbsp;KB) is the only data held in memory at
        any point — heap usage stays flat regardless of <code>limit</code>.
      </p>

      <h2>Additional parameters for requests</h2>
      <p>
        Extra filters available only on <code>GET /api/v1/exports/requests</code>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>projectId</code></td>
            <td>Export only requests belonging to a specific project.</td>
          </tr>
          <tr>
            <td><code>provider</code></td>
            <td>One of <code>openai</code> / <code>anthropic</code> / <code>gemini</code> / <code>azure</code>.</td>
          </tr>
          <tr>
            <td><code>model</code></td>
            <td>Partial match, case-insensitive (e.g. <code>mini</code>).</td>
          </tr>
          <tr>
            <td><code>providerKeyId</code></td>
            <td>Only requests that used a specific provider key.</td>
          </tr>
          <tr>
            <td><code>status</code></td>
            <td><code>ok</code> (2xx) / <code>4xx</code> / <code>5xx</code>.</td>
          </tr>
        </tbody>
      </table>

      <h2>File names</h2>
      <p>
        The response includes a <code>Content-Disposition</code> header with a date-stamped filename.
      </p>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Example filename</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>/exports/requests</code></td>
            <td><code>spanlens-requests-2026-05-15.csv</code></td>
          </tr>
          <tr>
            <td><code>/exports/traces</code></td>
            <td><code>spanlens-traces-2026-05-15.csv</code></td>
          </tr>
          <tr>
            <td><code>/exports/anomalies</code></td>
            <td><code>spanlens-anomalies-2026-05-15.csv</code></td>
          </tr>
          <tr>
            <td><code>/exports/security</code></td>
            <td><code>spanlens-security-2026-05-15.csv</code></td>
          </tr>
        </tbody>
      </table>

      <h2>CSV columns — requests</h2>
      <table>
        <thead>
          <tr>
            <th>Column</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>id</code></td>
            <td>Unique request ID</td>
          </tr>
          <tr>
            <td><code>project_id</code></td>
            <td>Project this request belongs to</td>
          </tr>
          <tr>
            <td><code>provider</code></td>
            <td>openai / anthropic / gemini / azure</td>
          </tr>
          <tr>
            <td><code>model</code></td>
            <td>Dated variant returned by the provider (e.g. <code>gpt-4o-mini-2024-07-18</code>)</td>
          </tr>
          <tr>
            <td><code>prompt_tokens</code></td>
            <td>Input token count (gross, including cached portion)</td>
          </tr>
          <tr>
            <td><code>completion_tokens</code></td>
            <td>Output token count</td>
          </tr>
          <tr>
            <td><code>total_tokens</code></td>
            <td>prompt + completion</td>
          </tr>
          <tr>
            <td><code>cost_usd</code></td>
            <td>Calculated cost in USD. Empty if the model is not in the price table.</td>
          </tr>
          <tr>
            <td><code>latency_ms</code></td>
            <td>Time from proxy receiving the request to last byte sent (ms)</td>
          </tr>
          <tr>
            <td><code>status_code</code></td>
            <td>HTTP status code returned by the provider</td>
          </tr>
          <tr>
            <td><code>error_message</code></td>
            <td>Error string. Empty for successful requests.</td>
          </tr>
          <tr>
            <td><code>trace_id</code></td>
            <td>Linked trace ID. Empty if the call was not made inside an SDK <code>observe()</code>.</td>
          </tr>
          <tr>
            <td><code>created_at</code></td>
            <td>When the request arrived at the proxy (ISO 8601 UTC)</td>
          </tr>
        </tbody>
      </table>

      <h2>CSV columns — traces</h2>
      <table>
        <thead>
          <tr>
            <th>Column</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>id</code></td>
            <td>Unique trace ID</td>
          </tr>
          <tr>
            <td><code>project_id</code></td>
            <td>Project this trace belongs to</td>
          </tr>
          <tr>
            <td><code>name</code></td>
            <td>Trace name (specified in the SDK)</td>
          </tr>
          <tr>
            <td><code>status</code></td>
            <td><code>ok</code> / <code>error</code></td>
          </tr>
          <tr>
            <td><code>error_message</code></td>
            <td>Error string. Empty for successful traces.</td>
          </tr>
          <tr>
            <td><code>duration_ms</code></td>
            <td>First span start to last span end (ms)</td>
          </tr>
          <tr>
            <td><code>total_cost_usd</code></td>
            <td>Sum of costs across all requests in the trace (USD)</td>
          </tr>
          <tr>
            <td><code>total_tokens</code></td>
            <td>Sum of tokens across all requests in the trace</td>
          </tr>
          <tr>
            <td><code>span_count</code></td>
            <td>Number of spans in the trace</td>
          </tr>
          <tr>
            <td><code>started_at</code></td>
            <td>Trace start time (ISO 8601 UTC)</td>
          </tr>
          <tr>
            <td><code>ended_at</code></td>
            <td>Trace end time (ISO 8601 UTC)</td>
          </tr>
          <tr>
            <td><code>created_at</code></td>
            <td>When the row was saved to the database (ISO 8601 UTC)</td>
          </tr>
        </tbody>
      </table>

      <h2>curl examples</h2>

      <h3>CSV download</h3>
      <CodeBlock language="bash">{`# Request logs — specific date range, GPT-4o only, CSV
curl "https://spanlens-server.vercel.app/api/v1/exports/requests?from=2026-05-01T00:00:00Z&to=2026-05-15T23:59:59Z&provider=openai&model=gpt-4o&format=csv" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-requests.csv

# Traces — last 7 days, JSON
curl "https://spanlens-server.vercel.app/api/v1/exports/traces?from=2026-05-08T00:00:00Z&format=json" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-traces.json

# Anomaly history — defaults (30 days, CSV)
curl "https://spanlens-server.vercel.app/api/v1/exports/anomalies" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-anomalies.csv

# Security flags — from a specific date
curl "https://spanlens-server.vercel.app/api/v1/exports/security?from=2026-05-01T00:00:00Z" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-security.csv`}</CodeBlock>

      <h3>JSONL download (large exports)</h3>
      <CodeBlock language="bash">{`# One million rows, streamed. Pipe straight into jq for filtering.
curl "https://spanlens-server.vercel.app/api/v1/exports/requests?format=jsonl&from=2026-01-01T00:00:00Z&limit=1000000" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  | jq -c 'select(.cost_usd != null and (.cost_usd | tonumber) > 0.01)' \\
  > expensive-requests.jsonl

# Each line is a self-contained JSON object:
# {"id":"req_xxx","provider":"openai","model":"gpt-4o-mini-2024-07-18",...}
# {"id":"req_yyy","provider":"anthropic","model":"claude-sonnet-4-5",...}`}</CodeBlock>

      <h3>JSON download (small, wrapped)</h3>
      <CodeBlock language="bash">{`curl "https://spanlens-server.vercel.app/api/v1/exports/requests?format=json&limit=1000" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"

# Response shape (buffered, capped at 10,000 rows):
# {
#   "exported_at": "2026-05-19T08:30:00.000Z",
#   "count": 1000,
#   "data": [
#     {
#       "id": "req_xxx",
#       "project_id": "proj_xxx",
#       "provider": "openai",
#       "model": "gpt-4o-mini-2024-07-18",
#       "prompt_tokens": 512,
#       "completion_tokens": 128,
#       "total_tokens": 640,
#       "cost_usd": 0.000096,
#       "latency_ms": 843,
#       "status_code": 200,
#       "error_message": null,
#       "trace_id": null,
#       "created_at": "2026-05-15T09:00:00.000Z"
#     },
#     ...
#   ]
# }`}</CodeBlock>

      <h2>BI tool tips</h2>

      <h3>Pandas (Python)</h3>
      <CodeBlock language="python">{`import pandas as pd

token = "YOUR_SUPABASE_ACCESS_TOKEN"

# Small / medium — CSV, single response.
url = "https://spanlens-server.vercel.app/api/v1/exports/requests?from=2026-05-01T00:00:00Z&format=csv"
df = pd.read_csv(url, storage_options={"Authorization": f"Bearer {token}"})

# Million-row pipeline — JSONL, streamed line-by-line. Pandas reads it in
# chunks so peak memory stays bounded.
url = "https://spanlens-server.vercel.app/api/v1/exports/requests?format=jsonl&limit=1000000"
chunks = pd.read_json(url, lines=True, chunksize=50_000,
                      storage_options={"Authorization": f"Bearer {token}"})
totals = pd.concat(chunk.groupby("model")["cost_usd"].sum() for chunk in chunks).groupby(level=0).sum()
print(totals)`}</CodeBlock>

      <h3>Excel</h3>
      <p>
        Download the <code>.csv</code> file with curl, then import it into Excel via{' '}
        <strong>Data → From Text/CSV</strong>. The <code>created_at</code> column is an ISO 8601
        string — convert it with <code>DATEVALUE</code> + <code>TIMEVALUE</code> or Power Query&apos;s
        date/time type conversion before using it in pivot tables.
      </p>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>Row caps.</strong> <code>/exports/requests</code> goes up to 1,000,000 rows on the
          streamed formats (<code>csv</code>, <code>jsonl</code>) and 10,000 on <code>json</code>.
          The other endpoints (<code>/traces</code>, <code>/security</code>, <code>/anomalies</code>)
          stay at 10,000. For datasets above the cap, paginate by splitting the time range with{' '}
          <code>from</code> / <code>to</code>, or contact support — multi-GB exports with completion
          emails / S3 pre-signed URLs are on the roadmap.
        </li>
        <li>
          <strong>request_body / response_body are not included.</strong> Body content is excluded
          for security and size reasons. View individual request bodies in the{' '}
          <a href="/requests">/requests</a> detail view or via{' '}
          <code>GET /api/v1/requests/:id</code>.
        </li>
        <li>
          <strong>Not real-time.</strong> Exports are a point-in-time snapshot. In-flight streaming
          requests or async logging delays may mean the most recent rows are not yet present.
        </li>
        <li>
          <strong>Rate limit.</strong> Export endpoints are capped at 10 requests per minute. Space
          out calls in bulk batch pipelines.
        </li>
        <li>
          <strong>Plan retention applies.</strong> The window of accessible rows is bounded by your
          plan&apos;s log retention (Free 14d / Pro 90d / Team 365d). Older rows are unavailable
          even via <code>from</code>.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/requests">Requests</a>,{' '}
        <a href="/docs/features/traces">Traces</a>,{' '}
        <a href="/docs/features/anomalies">Anomalies</a>,{' '}
        <a href="/docs/features/security">Security</a>.
      </p>
    </div>
  )
}
