import { openGraphFor } from '@/lib/page-metadata'
import { CodeBlock } from '../../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  alternates: { canonical: '/docs/features/export' },
  openGraph: openGraphFor('/docs/features/export'),
  title: 'Data Export · Spanlens Docs',
  description:
    'Download request logs, traces, anomalies, and security flags as CSV, JSONL, or JSON. Streamed exports go up to a million rows.',
}

export default function ExportDocs() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Data Export</h1>
      <p className="lead">
        Download request logs, traces, anomaly results, and security flags as CSV, JSONL, or JSON.
        The request export streams CSV and JSONL out of a database cursor and reads that cursor only
        as fast as your client downloads, so the server holds a small, fixed buffer no matter how many
        rows you ask for. Load the files into Pandas, BigQuery, Redash, Metabase, or your own
        pipeline.
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
            <td>
              Request logs: provider, model, tokens, cost, latency, status, and the user, session,
              and prompt version each request was tagged with.
            </td>
          </tr>
          <tr>
            <td><code>GET /api/v1/exports/traces</code></td>
            <td>Traces with span count, total cost, total tokens, and duration.</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/exports/anomalies</code></td>
            <td>
              The current anomaly check: one row for each provider, model, and metric (latency, cost,
              or error rate) whose last hour sits more than 3σ away from the previous 7 days.
            </td>
          </tr>
          <tr>
            <td><code>GET /api/v1/exports/security</code></td>
            <td>Requests flagged for PII or prompt injection, newest first.</td>
          </tr>
        </tbody>
      </table>
      <p>
        All endpoints require a signed-in dashboard session. Send{' '}
        <code>Authorization: Bearer &lt;supabase_access_token&gt;</code> with each request. Spanlens
        API keys (<code>sl_live_...</code>) are not accepted on these endpoints.
      </p>

      <h2>Parameters by endpoint</h2>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Accepted parameters</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>/exports/requests</code></td>
            <td>
              <code>format</code>, <code>from</code>, <code>to</code>, <code>limit</code>, and every
              filter in <a href="#request-filters">Filters for requests</a>.
            </td>
          </tr>
          <tr>
            <td><code>/exports/traces</code></td>
            <td>
              <code>format</code> (<code>csv</code> or <code>json</code>), <code>status</code>{' '}
              (<code>running</code>, <code>completed</code>, or <code>error</code>),{' '}
              <code>from</code>, <code>to</code>, <code>limit</code> (up to 10,000).
            </td>
          </tr>
          <tr>
            <td><code>/exports/anomalies</code></td>
            <td>
              <code>format</code> (<code>csv</code> or <code>json</code>) and <code>projectId</code>.
            </td>
          </tr>
          <tr>
            <td><code>/exports/security</code></td>
            <td>
              <code>format</code> (<code>csv</code> or <code>json</code>). It returns the latest
              10,000 flagged requests inside your retention window.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Request export parameters</h2>
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
              <code>csv</code>, <code>jsonl</code>, or <code>json</code>. CSV and JSONL stream; JSON
              is built in full before it is sent. See <a href="#formats">Formats</a> below.
            </td>
          </tr>
          <tr>
            <td><code>from</code></td>
            <td>None</td>
            <td>
              ISO 8601 start time, for example <code>2026-05-01T00:00:00Z</code>. Without it, the
              export starts at the oldest row your plan&apos;s retention window keeps (Free 14 days,
              Pro 90 days, Team 365 days).
            </td>
          </tr>
          <tr>
            <td><code>to</code></td>
            <td>None</td>
            <td>ISO 8601 end time, inclusive. Without it, the export runs up to the newest row.</td>
          </tr>
          <tr>
            <td><code>limit</code></td>
            <td>The format&apos;s cap</td>
            <td>
              CSV and JSONL: 1 to <strong>1,000,000</strong>. JSON: 1 to 10,000. Values outside the
              range are clamped to it.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="request-filters">Filters for requests</h2>
      <p>
        <code>GET /api/v1/exports/requests</code> takes the same filters as{' '}
        <code>GET /api/v1/requests</code>, so you can take a filtered list query, change the path,
        and export exactly those rows.
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
            <td>Only requests from one project (UUID).</td>
          </tr>
          <tr>
            <td><code>provider</code></td>
            <td>
              Provider id, for example <code>openai</code>, <code>anthropic</code>, or{' '}
              <code>gemini</code>. Exact match.
            </td>
          </tr>
          <tr>
            <td><code>model</code></td>
            <td>
              Case-insensitive substring of the stored model name (e.g. <code>mini</code>).{' '}
              <code>%</code> and <code>_</code> match themselves, not any character.
            </td>
          </tr>
          <tr>
            <td><code>providerKeyId</code></td>
            <td>Only requests that used one provider key (UUID).</td>
          </tr>
          <tr>
            <td><code>promptVersionId</code></td>
            <td>Only requests linked to one prompt version (UUID).</td>
          </tr>
          <tr>
            <td><code>userId</code></td>
            <td>
              Only requests tagged with this end-user id (the <code>x-spanlens-user</code> header, or{' '}
              <code>withUser()</code> in the SDK). Exact match.
            </td>
          </tr>
          <tr>
            <td><code>sessionId</code></td>
            <td>
              Only requests tagged with this session id (<code>x-spanlens-session</code>, or{' '}
              <code>withSession()</code>). Exact match.
            </td>
          </tr>
          <tr>
            <td><code>status</code></td>
            <td>
              <code>ok</code> or <code>success</code> (below 400), <code>4xx</code>,{' '}
              <code>5xx</code>, <code>error</code> (400 and above), or <code>all</code>.
            </td>
          </tr>
          <tr>
            <td><code>truncated</code></td>
            <td>
              <code>true</code> for streams that were cut off at the stream deadline,{' '}
              <code>false</code> for streams that finished, or <code>all</code>.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        A malformed UUID or date, or a <code>status</code> or <code>truncated</code> value not listed
        above, returns <code>400</code> with a <code>VALIDATION_FAILED</code> error before any data
        is sent.
      </p>

      <h2 id="formats">Formats, when to pick each</h2>
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
            <td>No, buffered</td>
            <td>10,000</td>
            <td>
              Wrapper object <code>{`{ exported_at, count, data: [...] }`}</code> for code that
              wants a single parseable response. Use <code>jsonl</code> for anything larger.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>How streamed exports behave</h2>
      <ul>
        <li>
          <strong>They go at your pace.</strong> The server fetches rows from the database only as
          fast as your client reads the response. If your client pauses, the server pauses with it
          and holds at most about 1&nbsp;MiB of encoded rows plus one database batch, so its memory
          use does not grow with <code>limit</code>.
        </li>
        <li>
          <strong>Early failures are ordinary errors.</strong> The server waits for the first row
          before it answers, so a query that cannot start returns a JSON error with a 5xx status
          instead of an empty or broken file.
        </li>
        <li>
          <strong>Late failures abort the download.</strong> Once rows are flowing, the status line
          has already said <code>200</code>. If the export fails after that, the server closes the
          connection without ending the file properly. curl exits with a non-zero status, and
          fetch, Pandas, and browsers report the download as failed instead of keeping a truncated
          file that looks complete.
        </li>
        <li>
          <strong>No caching.</strong> Streamed responses are sent with{' '}
          <code>Cache-Control: no-store</code>.
        </li>
      </ul>

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

      <h2>CSV columns, requests</h2>
      <p>
        Columns always come in this order. New columns are only ever added at the end, so scripts
        that read columns by position keep working.
      </p>
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
            <td>Provider id, for example <code>openai</code> or <code>anthropic</code></td>
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
          <tr>
            <td><code>user_id</code></td>
            <td>
              End-user id sent with the request. Empty when none was sent, or when the request used{' '}
              <code>x-spanlens-log-body: none</code>.
            </td>
          </tr>
          <tr>
            <td><code>session_id</code></td>
            <td>
              Session id sent with the request. Empty in the same cases as <code>user_id</code>.
            </td>
          </tr>
          <tr>
            <td><code>prompt_version_id</code></td>
            <td>Prompt version the request was linked to. Empty when it was not linked to one.</td>
          </tr>
        </tbody>
      </table>

      <h2>CSV columns, traces</h2>
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
            <td><code>running</code>, <code>completed</code>, or <code>error</code></td>
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
      <CodeBlock language="bash">{`# Request logs, specific date range, GPT-4o only, CSV
curl --fail "https://api.spanlens.io/api/v1/exports/requests?from=2026-05-01T00:00:00Z&to=2026-05-15T23:59:59Z&provider=openai&model=gpt-4o&format=csv" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-requests.csv

# One customer's requests, errors only
curl --fail "https://api.spanlens.io/api/v1/exports/requests?userId=customer-a&status=error&format=csv" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o customer-a-errors.csv

# Traces, last 7 days, JSON
curl --fail "https://api.spanlens.io/api/v1/exports/traces?from=2026-05-08T00:00:00Z&format=json" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-traces.json

# Current anomaly check, CSV
curl --fail "https://api.spanlens.io/api/v1/exports/anomalies" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-anomalies.csv

# Flagged requests, CSV
curl --fail "https://api.spanlens.io/api/v1/exports/security" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  -o spanlens-security.csv`}</CodeBlock>
      <p>
        <code>--fail</code> makes curl exit non-zero on a 4xx or 5xx status. A download that breaks
        off partway through already exits non-zero without it.
      </p>

      <h3>JSONL download (large exports)</h3>
      <CodeBlock language="bash">{`# One million rows, streamed. Pipe straight into jq for filtering.
curl --fail "https://api.spanlens.io/api/v1/exports/requests?format=jsonl&from=2026-01-01T00:00:00Z&limit=1000000" \\
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\
  | jq -c 'select(.cost_usd != null and .cost_usd > 0.01)' \\
  > expensive-requests.jsonl

# Each line is a self-contained JSON object:
# {"id":"req_xxx","provider":"openai","model":"gpt-4o-mini-2024-07-18",...}
# {"id":"req_yyy","provider":"anthropic","model":"claude-sonnet-4-5",...}`}</CodeBlock>

      <h3>JSON download (small, wrapped)</h3>
      <CodeBlock language="bash">{`curl --fail "https://api.spanlens.io/api/v1/exports/requests?format=json&limit=1000" \\
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
#       "created_at": "2026-05-15T09:00:00.000Z",
#       "user_id": "customer-a",
#       "session_id": null,
#       "prompt_version_id": null
#     },
#     ...
#   ]
# }`}</CodeBlock>

      <h2>BI tool tips</h2>

      <h3>Pandas (Python)</h3>
      <CodeBlock language="python">{`import pandas as pd

token = "YOUR_SUPABASE_ACCESS_TOKEN"

# Small / medium, CSV, single response.
url = "https://api.spanlens.io/api/v1/exports/requests?from=2026-05-01T00:00:00Z&format=csv"
df = pd.read_csv(url, storage_options={"Authorization": f"Bearer {token}"})

# Million-row pipeline, JSONL, streamed line-by-line. Pandas reads it in
# chunks so peak memory stays bounded.
url = "https://api.spanlens.io/api/v1/exports/requests?format=jsonl&limit=1000000"
chunks = pd.read_json(url, lines=True, chunksize=50_000,
                      storage_options={"Authorization": f"Bearer {token}"})
totals = pd.concat(chunk.groupby("model")["cost_usd"].sum() for chunk in chunks).groupby(level=0).sum()
print(totals)`}</CodeBlock>

      <h3>Excel</h3>
      <p>
        Download the <code>.csv</code> file with curl, then import it into Excel via{' '}
        <strong>Data → From Text/CSV</strong>. The <code>created_at</code> column is an ISO 8601
        string. Convert it with <code>DATEVALUE</code> + <code>TIMEVALUE</code> or Power Query&apos;s
        date/time type conversion before using it in pivot tables.
      </p>

      <h2>Exporting from the dashboard</h2>
      <p>
        The Export button on the Requests, Traces, Anomalies, and Security pages calls these
        endpoints and saves the result as CSV or JSON. The browser puts the whole file together in
        memory before it saves it, so for very large exports use curl or a script instead. The button
        shows how much has arrived while a large file downloads. If a download fails partway through,
        the dashboard shows the error and saves nothing, and Retry runs the same export again.
      </p>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>Row caps.</strong> <code>/exports/requests</code> goes up to 1,000,000 rows on the
          streamed formats (<code>csv</code>, <code>jsonl</code>) and 10,000 on <code>json</code>.
          The other endpoints (<code>/traces</code>, <code>/security</code>, <code>/anomalies</code>)
          stay at 10,000. An export that reaches its cap simply ends there, so if the row count
          equals the cap, split the time range with <code>from</code> and <code>to</code> and export
          each part. Multi-GB exports with completion emails or S3 pre-signed URLs are on the
          roadmap; contact support if you need one sooner.
        </li>
        <li>
          <strong>Five minutes per export.</strong> On the hosted service each export runs inside a
          single request, and the whole download has to finish within that time: the database
          query behind a streamed export is stopped after 290 seconds, counting the time spent
          waiting for your client to read, and the request itself ends at 300. Over a slow
          connection a million-row CSV may not finish in time, so export smaller date ranges
          instead.
        </li>
        <li>
          <strong>One streamed export at a time per server.</strong> A streamed export keeps a
          database connection open for as long as it downloads. If another one is already running
          on the server that picks up your request, you get <code>429</code> with a{' '}
          <code>Retry-After</code> header and an error whose <code>details.source</code> is{' '}
          <code>export_concurrency</code>. Wait a few seconds and send it again. In a script, run
          exports one after another rather than in parallel.
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
          <strong>Rate limit.</strong> Export calls count toward the dashboard API limit of 120
          requests per minute per access token. Space out calls in bulk batch pipelines.
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
