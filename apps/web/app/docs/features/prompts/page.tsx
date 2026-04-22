import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Prompts · Spanlens Docs',
  description:
    'Version-controlled prompt templates with real-data A/B comparison — latency, cost, and error rate per version.',
}

export default function PromptsDocs() {
  return (
    <div>
      <h1>Prompts</h1>
      <p className="lead">
        Store your prompt templates as named, versioned assets. Every time you tweak a prompt, Spanlens
        creates a new immutable version. Then compare versions side-by-side with real production
        metrics — average latency, error rate, and cost per call.
      </p>

      <h2>Why it matters</h2>
      <p>
        Prompts get edited constantly: a line added here, an example rewritten there, a tone shift
        on Friday afternoon. The unanswered question is always the same — <em>is this actually
        better, or does it just feel better?</em>
      </p>
      <p>
        Plain <code>.replace()</code> edits in your codebase give you no answers. Previous versions
        are lost, you can&apos;t roll back, and you never learn which version actually costs less or
        fails less. Spanlens Prompts fixes that without forcing you to adopt a new runtime or
        template engine.
      </p>

      <h2>How it works</h2>

      <h3>Versioning</h3>
      <p>
        Save a prompt under a name (e.g. <code>chatbot-system</code>) in the dashboard. Edit it
        later → a new version is auto-created with the next number. Old versions stay forever
        (immutable). No manual version bumps, no schema migrations.
      </p>
      <CodeBlock language="text">{`chatbot-system
  ├─ v1  (2 weeks ago)  "You are a helpful assistant..."
  ├─ v2  (1 week ago)   "You are a helpful Korean-speaking assistant..."
  └─ v3  (yesterday)    "You are a Korean assistant. Be concise..."`}</CodeBlock>

      <p>Each version stores:</p>
      <ul>
        <li><code>content</code> — the template body (up to 100K chars)</li>
        <li><code>variables</code> — typed placeholders like <code>{'{{userName}}'}</code> with description and <code>required</code> flag</li>
        <li><code>metadata</code> — free-form JSON for tags (team, task type, model target, etc.)</li>
        <li><code>project_id</code> — optional project scope</li>
      </ul>

      <h3>A/B comparison on real traffic</h3>
      <p>
        Click a prompt in <a href="/prompts">/prompts</a> and you&apos;ll see a comparison table of
        every version that has received production traffic in the last 30 days:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th className="text-right">Samples</th>
              <th className="text-right">Avg latency</th>
              <th className="text-right">Error %</th>
              <th className="text-right">Avg cost</th>
              <th className="text-right">Total cost</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>v3</td>
              <td className="text-right">1,245</td>
              <td className="text-right">820ms</td>
              <td className="text-right">0.4%</td>
              <td className="text-right">$0.0012</td>
              <td className="text-right">$1.49</td>
            </tr>
            <tr>
              <td>v2</td>
              <td className="text-right">3,102</td>
              <td className="text-right">1.2s</td>
              <td className="text-right">1.1%</td>
              <td className="text-right">$0.0018</td>
              <td className="text-right">$5.58</td>
            </tr>
            <tr>
              <td>v1</td>
              <td className="text-right">890</td>
              <td className="text-right">1.4s</td>
              <td className="text-right">2.3%</td>
              <td className="text-right">$0.0023</td>
              <td className="text-right">$2.04</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        In this example v3 is 32% faster, has 1/5 the error rate, and costs 33% less per call than
        v2. That&apos;s a clear keep-v3, retire-v2 decision with actual numbers behind it.
      </p>

      <h2>Using it</h2>

      <h3>Creating a prompt version via dashboard</h3>
      <ol>
        <li>Go to <a href="/prompts">/prompts</a> and click <strong>New prompt / version</strong>.</li>
        <li>Enter a name (e.g. <code>chatbot-system</code>). Reusing a name → new version.</li>
        <li>Paste the content. Save.</li>
      </ol>

      <h3>Creating via API</h3>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/prompts \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "chatbot-system",
    "content": "You are a Korean assistant. Be concise.",
    "metadata": { "team": "growth", "tested": true }
  }'`}</CodeBlock>
      <p>
        Response includes the auto-assigned <code>version</code>. See the full endpoint list below.
      </p>

      <h3>Fetching the comparison data</h3>
      <CodeBlock language="bash">{`GET /api/v1/prompts/:name/compare?sinceHours=720

# returns per-version metrics:
#   { version, sampleCount, avgLatencyMs, errorRate, avgCostUsd, totalCostUsd }`}</CodeBlock>

      <h3>API reference</h3>
      <table>
        <thead>
          <tr>
            <th>Method + Path</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>GET /api/v1/prompts</code></td>
            <td>List all prompts (latest version per name)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/prompts/:name</code></td>
            <td>Full version history for a prompt name</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/prompts/:name/compare</code></td>
            <td>Per-version metrics for A/B comparison</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/prompts/:name/:version</code></td>
            <td>Fetch one specific version</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/prompts</code></td>
            <td>Create a new version (auto-increments version number)</td>
          </tr>
          <tr>
            <td><code>DELETE /api/v1/prompts/:name/:version</code></td>
            <td>Delete one version</td>
          </tr>
        </tbody>
      </table>

      <h2>Limitations</h2>
      <p>Honest view of what the feature does <em>not</em> do yet:</p>
      <ul>
        <li>
          <strong>Request ↔ version linkage is not yet exposed in the SDK.</strong> The database has
          a <code>prompt_version_id</code> column on <code>requests</code>, but the{' '}
          <code>@spanlens/sdk</code> helpers don&apos;t currently provide a one-line way to tag a
          request with a prompt version. Tracking this as a launch blocker.
        </li>
        <li>
          <strong>No editor affordances.</strong> The create/edit form is a plain textarea —
          no diff view, no syntax highlighting, no variable autocomplete. Good enough for now;
          polish deferred to post-launch.
        </li>
        <li>
          <strong>Comparison window is fixed at 30 days in the UI.</strong> The API accepts a{' '}
          <code>sinceHours</code> query parameter; we just haven&apos;t wired a UI picker yet.
        </li>
        <li>
          <strong>No statistical-significance hints.</strong> If v1 has 5 samples and v2 has 5,000,
          both show up the same way in the table. Significance flags are on the roadmap.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/savings">Savings</a> (model substitution recommendations),{' '}
        <a href="/docs/features/traces">Traces</a> (agent span tree), <a href="/prompts">/prompts</a>{' '}
        dashboard.
      </p>
    </div>
  )
}
