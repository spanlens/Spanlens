import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Prompt A/B · Spanlens Docs',
  description:
    'Route live production traffic across two prompt versions and measure latency, cost, and error rate with statistical significance.',
}

export default function PromptAbDocs() {
  return (
    <div>
      <h1>Prompt A/B</h1>
      <p className="lead">
        Split real production traffic across two prompt versions and compare latency, cost, and error
        rate with statistical tests. Use offline{' '}
        <a href="/docs/features/experiments">Experiments</a> to validate first, then run A/B on real
        users to make the final call.
      </p>

      <h2>A/B vs Experiments — which one to use</h2>
      <p>
        Spanlens has two places where the word &quot;experiment&quot; appears. Here is how they
        differ:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>A/B (this page)</th>
              <th><a href="/docs/features/experiments">Experiments</a> (offline)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Data source</td>
              <td>Real user traffic</td>
              <td>Pre-defined dataset</td>
            </tr>
            <tr>
              <td>Timing</td>
              <td>Real-time (days to weeks)</td>
              <td>Runs immediately (minutes)</td>
            </tr>
            <tr>
              <td>User exposure</td>
              <td>Yes — real users see it</td>
              <td>None</td>
            </tr>
            <tr>
              <td>Measurement</td>
              <td>Statistical significance (p-value)</td>
              <td>Side-by-side output comparison + scores</td>
            </tr>
            <tr>
              <td>Key metrics</td>
              <td>Latency, cost, error rate</td>
              <td>Response quality, score distribution</td>
            </tr>
            <tr>
              <td>Risk</td>
              <td>A bad version reaches real users</td>
              <td>None</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Recommended order: <strong>validate with Experiments → confirm with A/B in production</strong>.
        The two tools are complementary, not alternatives.
      </p>

      <h2>How it works</h2>
      <p>
        Creating an A/B experiment tells the server to split incoming requests for a given prompt
        name between Version A (control) and Version B (challenger) according to the{' '}
        <code>trafficSplit</code> ratio. The split is applied automatically to requests that pass
        through the <a href="/docs/proxy">Spanlens proxy</a>. Each request result is recorded in
        the <code>requests</code> table and accumulates until the experiment ends or is manually
        stopped.
      </p>

      <h2>Creating an experiment</h2>
      <CodeBlock language="bash">{`POST /api/v1/prompt-experiments`}</CodeBlock>
      <p>Auth: JWT (<code>Authorization: Bearer $SPANLENS_JWT</code>)</p>

      <h3>Request parameters</h3>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Required</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>promptName</code></td>
              <td>string</td>
              <td>Yes</td>
              <td>Prompt name to run the experiment on (e.g. <code>chatbot-system</code>)</td>
            </tr>
            <tr>
              <td><code>versionAId</code></td>
              <td>string (UUID)</td>
              <td>Yes</td>
              <td>Prompt version ID for the control arm</td>
            </tr>
            <tr>
              <td><code>versionBId</code></td>
              <td>string (UUID)</td>
              <td>Yes</td>
              <td>Prompt version ID for the challenger arm</td>
            </tr>
            <tr>
              <td><code>trafficSplit</code></td>
              <td>integer</td>
              <td>Optional (default 50)</td>
              <td>
                Percentage of traffic to send to Version B (1–99). E.g. 20 means B:20%, A:80%.
                Default 50 is an even split.
              </td>
            </tr>
            <tr>
              <td><code>endsAt</code></td>
              <td>string (ISO 8601)</td>
              <td>Optional</td>
              <td>Auto-end date/time. Runs indefinitely until stopped manually if omitted.</td>
            </tr>
            <tr>
              <td><code>projectId</code></td>
              <td>string (UUID)</td>
              <td>Optional</td>
              <td>Scope the experiment to a specific project. Defaults to organization-wide.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Example</h3>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/prompt-experiments \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "promptName":   "chatbot-system",
    "versionAId":   "ae1c3c1e-99eb-4f2a-b821-000000000001",
    "versionBId":   "ae1c3c1e-99eb-4f2a-b821-000000000002",
    "trafficSplit": 20,
    "endsAt":       "2026-06-01T00:00:00Z"
  }'`}</CodeBlock>

      <h2>Experiment status</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>status</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>running</code></td>
              <td>Actively splitting traffic and accumulating data</td>
            </tr>
            <tr>
              <td><code>concluded</code></td>
              <td>Ended automatically when <code>endsAt</code> was reached or a winner was set</td>
            </tr>
            <tr>
              <td><code>stopped</code></td>
              <td>Manually stopped before conclusion — no winner declared</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Statistical metrics</h2>
      <p>
        Three statistical tests are computed in real time for each experiment:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Test</th>
              <th>Significance threshold</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Latency</td>
              <td>Welch&apos;s t-test</td>
              <td>p-value &lt; 0.05</td>
            </tr>
            <tr>
              <td>Cost</td>
              <td>Welch&apos;s t-test</td>
              <td>p-value &lt; 0.05</td>
            </tr>
            <tr>
              <td>Error rate</td>
              <td>Fisher&apos;s exact test</td>
              <td>p-value &lt; 0.05</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        A <strong>p-value &lt; 0.05</strong> means the difference is statistically significant.
        With small sample sizes (tens of requests), p-values cluster near 1 — wait a few days for
        data to accumulate before drawing conclusions.
      </p>
      <p>
        Welch&apos;s t-test is valid even when the two groups have unequal variances. Fisher&apos;s
        exact test is more appropriate for binary (success/failure) metrics like error rate.
      </p>

      <h2>Declaring a winner</h2>
      <p>
        When one version is statistically better, declare it the winner. The experiment status
        changes to <code>concluded</code> and traffic splitting stops.
      </p>
      <CodeBlock language="bash">{`PATCH /api/v1/prompt-experiments/:id

curl -X PATCH https://spanlens-server.vercel.app/api/v1/prompt-experiments/<experiment-id> \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "winnerVersionId": "ae1c3c1e-99eb-4f2a-b821-000000000002"
  }'`}</CodeBlock>
      <p>
        To promote the winning version as the production default, use the{' '}
        <a href="/docs/features/prompts">Prompts</a> <strong>Roll back</strong> button or create a
        new version with the winning content.
      </p>

      <h2>Duplicate experiment guard</h2>
      <p>
        If a <code>running</code> experiment already exists for the same <code>promptName</code>,
        creating a new one returns <code>409 Conflict</code>. Stop the existing experiment first or
        wait for its <code>endsAt</code> before starting a new one.
      </p>

      <h2>API reference</h2>
      <table>
        <thead>
          <tr>
            <th>Method + Path</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>POST /api/v1/prompt-experiments</code></td>
            <td>Create experiment and start traffic split</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/prompt-experiments?promptName=...</code></td>
            <td>List experiments for a prompt name (newest first)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/prompt-experiments/:id</code></td>
            <td>Experiment status, aggregated metrics, and p-values</td>
          </tr>
          <tr>
            <td><code>PATCH /api/v1/prompt-experiments/:id</code></td>
            <td>Set winner or manually stop (<code>status: "stopped"</code>)</td>
          </tr>
        </tbody>
      </table>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>Two arms only.</strong> Only A and B can be compared at once. Run separate
          experiments to compare more than two versions simultaneously.
        </li>
        <li>
          <strong>One running experiment per prompt name.</strong> A new experiment cannot be
          created while one is already running.
        </li>
        <li>
          <strong>Statistical significance requires sufficient samples.</strong> With only a few
          dozen calls per day, it may take weeks to reach a meaningful conclusion. Use{' '}
          <a href="/docs/features/experiments">Experiments</a> for faster offline validation first.
        </li>
        <li>
          <strong>Response quality is not measured.</strong> Only latency, cost, and error rate are
          tracked. Pair with <a href="/docs/features/evals">Evals</a> for quality scoring.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/prompts">Prompts</a> (version management),{' '}
        <a href="/docs/features/experiments">Experiments</a> (offline dataset comparison),{' '}
        <a href="/docs/features/evals">Evals</a> (LLM-as-judge quality scoring),{' '}
        <a href="/prompts">/prompts</a> dashboard.
      </p>
    </div>
  )
}
