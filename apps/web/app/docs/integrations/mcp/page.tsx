import Link from 'next/link'
import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'MCP integration · Spanlens Docs',
  description:
    'Query Spanlens LLM cost, traces, and anomalies directly from Cursor, Claude Desktop, or Continue via the Model Context Protocol. Public-scope keys keep the credential safe in plaintext IDE config files.',
  alternates: { canonical: '/docs/integrations/mcp' },
}

export default function MCPIntegration() {
  return (
    <div>
      <h1>MCP integration</h1>
      <p className="lead">
        Spanlens ships an{' '}
        <a href="https://www.npmjs.com/package/@spanlens/mcp-server" target="_blank" rel="noopener noreferrer">
          official MCP server
        </a>{' '}
        so the agent inside Cursor, Claude Desktop, or Continue can answer
        questions like &quot;what&apos;s our OpenAI spend this week?&quot;,
        &quot;any cost anomalies?&quot;, or &quot;walk me through trace
        <em>X</em>&quot; against your live workspace. The server is also listed
        on the{' '}
        <a href="https://registry.modelcontextprotocol.io/v0/servers?search=io.github.spanlens" target="_blank" rel="noopener noreferrer">
          MCP Registry
        </a>{' '}
        as <code>io.github.spanlens/mcp-server</code>.
      </p>

      <h2 id="public-key">1. Issue a public-scope key</h2>
      <p>
        Public-scope keys (<code>sl_live_pub_*</code>) can only read dashboard
        data — they cannot trigger LLM proxy spend or write ingest rows. The
        MCP server refuses to start with a full-access <code>sl_live_*</code>
        {' '}key, because the credential lives in a plaintext config file in
        your IDE.
      </p>
      <p>
        Create one from the <strong>Public Keys</strong> card at the top of{' '}
        <Link href="/projects">spanlens.io/projects</Link> → <strong>+ New
        public key</strong>. Copy the <code>sl_live_pub_…</code> value when
        it&apos;s shown (it&apos;s only displayed once).
      </p>

      <h2 id="setup">2. Add the server to your IDE</h2>
      <p>
        The same JSON shape works for every stdio-based MCP client. Pick yours:
      </p>

      <h3 id="cursor">Cursor</h3>
      <p>
        Edit <code>~/.cursor/mcp.json</code> (or workspace
        {' '}<code>.cursor/mcp.json</code>):
      </p>
      <CodeBlock language="json">{`{
  "mcpServers": {
    "spanlens": {
      "command": "npx",
      "args": ["-y", "@spanlens/mcp-server"],
      "env": { "SPANLENS_API_KEY": "sl_live_pub_..." }
    }
  }
}`}</CodeBlock>

      <h3 id="claude-desktop">Claude Desktop</h3>
      <p>
        Edit <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS)
        or <code>%APPDATA%\Claude\claude_desktop_config.json</code> (Windows):
      </p>
      <CodeBlock language="json">{`{
  "mcpServers": {
    "spanlens": {
      "command": "npx",
      "args": ["-y", "@spanlens/mcp-server"],
      "env": { "SPANLENS_API_KEY": "sl_live_pub_..." }
    }
  }
}`}</CodeBlock>

      <h3 id="continue">Continue</h3>
      <p>
        Edit <code>~/.continue/config.yaml</code>:
      </p>
      <CodeBlock language="yaml">{`mcpServers:
  - name: spanlens
    command: npx
    args: ['-y', '@spanlens/mcp-server']
    env:
      SPANLENS_API_KEY: sl_live_pub_...`}</CodeBlock>

      <h2 id="ask">3. Reload your IDE and start asking</h2>
      <p>
        The agent discovers seven tools and uses them automatically when the
        question matches.
      </p>

      <h2 id="tools">Available tools</h2>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>What it returns</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>get_stats</code></td>
            <td>Aggregate cost, request count, token usage, latency, error
              rate. Optional <code>groupBy</code> for per-model or
              per-provider breakdown.</td>
          </tr>
          <tr>
            <td><code>query_requests</code></td>
            <td>Individual LLM requests with filters: model, provider, status
              (<code>success</code> / <code>error</code> / <code>4xx</code> /
              <code>5xx</code>), userId, since, limit.</td>
          </tr>
          <tr>
            <td><code>list_traces</code></td>
            <td>Agent traces matching status / since / query. Returns trace IDs
              to feed into <code>get_trace</code>.</td>
          </tr>
          <tr>
            <td><code>get_trace</code></td>
            <td>Full span tree for one trace — every LLM / tool / retrieval
              span with timing, tokens, cost.</td>
          </tr>
          <tr>
            <td><code>get_anomalies</code></td>
            <td>Cost / latency / error-rate anomalies with optional severity
              filter.</td>
          </tr>
          <tr>
            <td><code>get_savings</code></td>
            <td>Model-swap recommendations with projected monthly savings and
              adoption status.</td>
          </tr>
          <tr>
            <td><code>get_user_analytics</code></td>
            <td>Per-end-user usage breakdown — total cost, request count,
              models touched, recent calls.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="safety">Safety</h2>
      <p>
        Two layers keep a leaked IDE config from causing damage:
      </p>
      <ol>
        <li>
          <strong>Boot-time scope check.</strong> The server calls{' '}
          <code>/api/v1/me/key-info</code> on startup and refuses to start if
          the response carries <code>scope=&quot;full&quot;</code>. The error
          message points back at the Public Keys card so it&apos;s obvious how
          to fix.
        </li>
        <li>
          <strong>API-layer enforcement.</strong> Even if a public key leaks,
          it cannot call <code>/proxy/*</code> or <code>/ingest/*</code> — the
          Spanlens server returns 403 +{' '}
          <code>PUBLIC_KEY_WRITE_FORBIDDEN</code>. The blast radius of a leak
          is &quot;competitor sees my usage stats&quot;, not &quot;competitor
          runs up my OpenAI bill&quot;.
        </li>
      </ol>

      <h2 id="self-host">Self-hosted Spanlens</h2>
      <p>
        Point the server at your own deployment by setting{' '}
        <code>SPANLENS_BASE_URL</code>. Trailing slashes are normalised.
      </p>
      <CodeBlock language="json">{`{
  "mcpServers": {
    "spanlens": {
      "command": "npx",
      "args": ["-y", "@spanlens/mcp-server"],
      "env": {
        "SPANLENS_API_KEY": "sl_live_pub_...",
        "SPANLENS_BASE_URL": "https://spanlens.your-company.com"
      }
    }
  }
}`}</CodeBlock>

      <h2 id="links">Links</h2>
      <ul>
        <li>
          <a href="https://www.npmjs.com/package/@spanlens/mcp-server" target="_blank" rel="noopener noreferrer">
            <code>@spanlens/mcp-server</code> on npm
          </a>
        </li>
        <li>
          <a href="https://github.com/spanlens/Spanlens/tree/main/packages/mcp-server" target="_blank" rel="noopener noreferrer">
            Source on GitHub
          </a>
        </li>
        <li>
          <a href="https://registry.modelcontextprotocol.io/v0/servers?search=io.github.spanlens" target="_blank" rel="noopener noreferrer">
            MCP Registry entry
          </a>
        </li>
        <li>
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">
            Model Context Protocol spec
          </a>
        </li>
      </ul>
    </div>
  )
}
