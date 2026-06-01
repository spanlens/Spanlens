import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Experiments · Spanlens Docs',
  description:
    'Offline side-by-side comparison, run a dataset against two prompt versions and compare outputs, scores, and cost without touching production traffic.',
}

export default function ExperimentsDocs() {
  return (
    <div>
      <h1>Experiments</h1>
      <p className="lead">
        Run each input in a dataset through <strong>two prompt versions</strong>, compare outputs
        with a word-level diff, and optionally score both sides with an evaluator. Answer
        &quot;is v3 actually better than v2?&quot; in minutes, with no impact on production traffic.
      </p>

      <h2>A/B (Prompts) vs Experiments</h2>
      <p>
        Spanlens has two places where the word &quot;experiment&quot; appears. They serve
        different purposes:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>A/B (inside Prompts tab)</th>
              <th>Experiments (this page)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Data</td>
              <td>Live production traffic</td>
              <td>Offline dataset</td>
            </tr>
            <tr>
              <td>Timing</td>
              <td>Real-time (days to weeks)</td>
              <td>Runs immediately (minutes)</td>
            </tr>
            <tr>
              <td>Measurement</td>
              <td>Statistical significance (Welch&apos;s t-test)</td>
              <td>Direct output comparison + scores</td>
            </tr>
            <tr>
              <td>Risk</td>
              <td>A bad version reaches real users</td>
              <td>None</td>
            </tr>
            <tr>
              <td>Cost predictability</td>
              <td>Hard (days of traffic)</td>
              <td>Exact (items × 2 + judge × 2)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        They are complementary:{' '}
        <strong>use Experiments to pre-validate → use A/B to confirm in production</strong>.
      </p>

      <h2>Run flow</h2>
      <ol>
        <li>
          Go to <a href="/experiments">/experiments</a> and click <strong>New experiment</strong>.
        </li>
        <li>
          Choose name → prompt → Version A (control) / Version B (challenger) → dataset →
          optional evaluator → run provider / model.
        </li>
        <li>
          The server runs both versions against each dataset item using the same model
          (concurrency 3).
        </li>
        <li>
          If an evaluator is specified, both outputs are scored by the LLM judge.
        </li>
        <li>
          Results appear as: KPI cards (avg_A, avg_B, Δ, total_cost) + expandable rows with
          word-level diff highlighting.
        </li>
      </ol>

      <h2>Word-level diff highlighting</h2>
      <p>Expanding a result row shows both outputs side by side, with differences color-coded.</p>
      <ul>
        <li><strong>Red</strong>, words present in A but not in B</li>
        <li><strong>Green</strong>, words present in B but not in A</li>
        <li>Identical words have no highlight</li>
      </ul>
      <p>
        This is a simple token-level comparison rather than a semantic diff, but it immediately
        shows which parts of the output changed.
      </p>

      <h2>Cost visibility</h2>
      <p>
        All LLM calls are <strong>billed to your provider key</strong> (Spanlens does not cover
        them). Approximate breakdown:
      </p>
      <ul>
        <li>Prompt runs: <code>dataset items × 2</code> (one per arm)</li>
        <li>Judge calls (if evaluator set): <code>+ dataset items × 2</code></li>
        <li>Total calls = <code>items × 2 × (2 if evaluator, else 1)</code></li>
      </ul>
      <p>
        Example: 50-item dataset with an evaluator → 50×4 = 200 LLM calls. With gpt-4o-mini,
        roughly under $0.10.
      </p>
      <p>Hard cap: dataset items limited to <strong>200 per experiment</strong>.</p>

      <h2>API</h2>
      <table>
        <thead>
          <tr>
            <th>Method + Path</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>POST /api/v1/experiments</code></td>
            <td>Create and start in background (returns 202 immediately)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/experiments?promptName=...</code></td>
            <td>List experiments (max 50)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/experiments/:id</code></td>
            <td>Status and aggregated scores (poll while pending/running)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/experiments/:id/results</code></td>
            <td>Per-item results for both arms with dataset_items joined</td>
          </tr>
        </tbody>
      </table>

      <h3>Example</h3>
      <CodeBlock language="bash">{`curl https://server.spanlens.io/api/v1/experiments \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "support v2 vs v3",
    "promptName": "support_reply",
    "versionAId": "<v2-id>",
    "versionBId": "<v3-id>",
    "datasetId": "<dataset-id>",
    "evaluatorId": "<optional-evaluator-id>",
    "runProvider": "openai",
    "runModel": "gpt-4o-mini"
  }'`}</CodeBlock>

      <h2>Input handling rules</h2>
      <p>
        How the dataset item&apos;s <code>input</code> shape determines what gets sent to the model:
      </p>
      <ul>
        <li>
          <code>{`{ "variables": {...} }`}</code>, substitutes <code>{`{{var}}`}</code>{' '}
          placeholders in the prompt content and passes the result as the user message.
        </li>
        <li>
          <code>{`{ "messages": [...] }`}</code>, extracts the last user message and passes it
          in the user role (prompt content becomes the system role).
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>Two arms only.</strong> Compare more than two versions by running separate
          experiments.
        </li>
        <li>
          <strong>Same model for both arms.</strong> Both versions run with the same{' '}
          <code>run_model</code>. To compare different models, run two separate experiments.
        </li>
        <li>
          <strong>No pause / resume.</strong> Once started, the experiment runs to completion or
          fails.
        </li>
        <li>
          <strong>200-item hard cap.</strong> For large-scale regression testing, split the
          dataset across multiple experiments.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/datasets">Datasets</a>,{' '}
        <a href="/docs/features/evals">Evals</a>,{' '}
        <a href="/docs/features/prompts">Prompts</a> (A/B live traffic routing),{' '}
        <a href="/experiments">/experiments</a> dashboard.
      </p>
    </div>
  )
}
