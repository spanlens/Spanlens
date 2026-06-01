export const metadata = {
  title: 'REST API Reference · Spanlens Docs',
  description:
    'Interactive OpenAPI 3.0 reference for the Spanlens REST API. Authentication, requests, stats, traces, anomalies, members, and proxy endpoints.',
}

const SERVER_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://server.spanlens.io'

export default function ApiReferencePage() {
  const swaggerUiUrl = `${SERVER_URL}/api/v1/docs`
  const specUrl = `${SERVER_URL}/api/v1/openapi.json`

  return (
    <div>
      <h1>REST API Reference</h1>
      <p className="lead">
        The Spanlens REST API backs the dashboard and is stable for direct
        use. All authenticated endpoints require a Supabase JWT in{' '}
        <code>Authorization: Bearer …</code>. Proxy endpoints use a Spanlens
        API key.
      </p>

      <div className="flex flex-wrap gap-3 my-5 not-prose">
        <a
          href={swaggerUiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-bg-elev text-sm font-mono hover:bg-bg-muted transition-colors text-text"
        >
          Open Swagger UI ↗
        </a>
        <a
          href={specUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-bg-elev text-sm font-mono hover:bg-bg-muted transition-colors text-text"
        >
          openapi.json ↗
        </a>
      </div>

      <h2 id="auth">Authentication</h2>
      <p>Two security schemes are used:</p>
      <table>
        <thead>
          <tr>
            <th>Scheme</th>
            <th>Header</th>
            <th>Used for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>BearerJWT</strong></td>
            <td><code>Authorization: Bearer &lt;jwt&gt;</code></td>
            <td>All <code>/api/v1/*</code> dashboard endpoints</td>
          </tr>
          <tr>
            <td><strong>ApiKey</strong></td>
            <td><code>Authorization: Bearer sl_live_…</code></td>
            <td>Proxy endpoints (<code>/proxy/*</code>) and SDK ingest (<code>/ingest/*</code>)</td>
          </tr>
        </tbody>
      </table>
      <p>
        JWTs are obtained from Supabase Auth (<code>supabase.auth.getSession()</code>) and
        expire after 1 hour. Spanlens API keys (<code>sl_live_…</code>) are created at{' '}
        <a href="/projects">/projects</a> by clicking <em>+ New Spanlens key</em> on the
        project card; they never expire (revoke explicitly via the toggle when rotating). For
        the cryptographic details + the per-SDK auth-header mapping, see{' '}
        <a href="/docs/features/settings">Keys &amp; encryption</a> and{' '}
        <a href="/docs/proxy">Direct proxy</a>.
      </p>

      <h2 id="base-urls">Base URLs</h2>
      <table>
        <thead>
          <tr>
            <th>Environment</th>
            <th>Base URL</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Production (hosted)</td>
            <td><code>https://server.spanlens.io</code></td>
          </tr>
          <tr>
            <td>Local dev</td>
            <td><code>http://localhost:3001</code></td>
          </tr>
          <tr>
            <td>Self-hosted</td>
            <td><code>https://your-spanlens.example.com</code></td>
          </tr>
        </tbody>
      </table>

      <h2 id="endpoints">Endpoint groups</h2>
      <table>
        <thead>
          <tr>
            <th>Group</th>
            <th>Prefix</th>
            <th>Auth</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Health</td><td><code>GET /health</code></td><td>None</td></tr>
          <tr><td>Organizations</td><td><code>/api/v1/organizations</code></td><td>JWT</td></tr>
          <tr><td>Projects</td><td><code>/api/v1/projects</code></td><td>JWT</td></tr>
          <tr><td>API keys</td><td><code>/api/v1/api-keys</code></td><td>JWT</td></tr>
          <tr><td>Provider keys</td><td><code>/api/v1/provider-keys</code></td><td>JWT</td></tr>
          <tr><td>Requests</td><td><code>/api/v1/requests</code></td><td>JWT</td></tr>
          <tr><td>Stats</td><td><code>/api/v1/stats</code></td><td>JWT</td></tr>
          <tr><td>Traces</td><td><code>/api/v1/traces</code></td><td>JWT</td></tr>
          <tr><td>Prompts</td><td><code>/api/v1/prompts</code></td><td>JWT</td></tr>
          <tr><td>Anomalies</td><td><code>/api/v1/anomalies</code></td><td>JWT</td></tr>
          <tr><td>Security</td><td><code>/api/v1/security</code></td><td>JWT</td></tr>
          <tr><td>Alerts</td><td><code>/api/v1/alerts</code></td><td>JWT</td></tr>
          <tr><td>Recommendations</td><td><code>/api/v1/recommendations</code></td><td>JWT</td></tr>
          <tr><td>Evals</td><td><code>/api/v1/evaluators</code></td><td>JWT</td></tr>
          <tr><td>Datasets</td><td><code>/api/v1/datasets</code></td><td>JWT</td></tr>
          <tr><td>Experiments</td><td><code>/api/v1/experiments</code></td><td>JWT</td></tr>
          <tr><td>Prompt experiments (A/B)</td><td><code>/api/v1/prompt-experiments</code></td><td>JWT</td></tr>
          <tr><td>Prompt playground</td><td><code>/api/v1/prompts-playground/run</code></td><td>JWT</td></tr>
          <tr><td>Human evals</td><td><code>/api/v1/human-evals</code></td><td>JWT</td></tr>
          <tr><td>Annotation queue</td><td><code>/api/v1/annotation/queue</code></td><td>JWT</td></tr>
          <tr><td>Webhooks</td><td><code>/api/v1/webhooks</code></td><td>JWT (admin/editor for writes)</td></tr>
          <tr><td>Audit logs</td><td><code>/api/v1/audit-logs</code></td><td>JWT</td></tr>
          <tr><td>Saved filters</td><td><code>/api/v1/saved-filters</code></td><td>JWT</td></tr>
          <tr><td>Exports</td><td><code>/api/v1/exports/*</code></td><td>JWT</td></tr>
          <tr><td>Members</td><td><code>/api/v1/organizations/:orgId/members</code></td><td>JWT (admin for writes)</td></tr>
          <tr><td>Invitations</td><td><code>/api/v1/organizations/:orgId/invitations</code></td><td>JWT (admin)</td></tr>
          <tr><td>Proxy, OpenAI</td><td><code>/proxy/openai/v1/*</code></td><td>API key</td></tr>
          <tr><td>Proxy, Anthropic</td><td><code>/proxy/anthropic/v1/*</code></td><td>API key</td></tr>
          <tr><td>Proxy, Gemini</td><td><code>/proxy/gemini/v1/*</code></td><td>API key</td></tr>
          <tr><td>Proxy, Azure OpenAI</td><td><code>/proxy/azure/*</code></td><td>API key</td></tr>
          <tr><td>SDK Ingest</td><td><code>/ingest/*</code></td><td>API key</td></tr>
        </tbody>
      </table>

      <p>
        For the full interactive spec, request/response schemas, try-it-out,
        example curl commands, open the{' '}
        <a href={swaggerUiUrl} target="_blank" rel="noopener noreferrer">
          Swagger UI
        </a>.
      </p>

      <h3>Plan-gated responses to know about</h3>
      <p>
        A few endpoints respond with <code>HTTP 402 Payment Required</code>{' '}
        when a plan limit is hit, so your client can distinguish &quot;you ran out
        of headroom&quot; from a generic 400/403:
      </p>
      <ul>
        <li>
          <code>POST /api/v1/organizations</code> returns 402 with{' '}
          <code>{`{ "code": "workspace_limit_reached", "error": "…", "owned": N, "limit": M, "effectivePlan": "…" }`}</code>{' '}
          when the caller already owns the maximum workspaces their effective
          plan allows (Free 1, Pro 2, Team 5, Enterprise unlimited). Upgrade
          any owned workspace and retry. See{' '}
          <a href="/docs/features/billing">Billing &amp; quotas</a> for the
          full per-plan table.
        </li>
      </ul>
    </div>
  )
}
