import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Prompts Playground · Spanlens Docs',
  description:
    'Interactive console inside the Prompts tab — select a version, set model, temperature, and variables, then run it immediately and see cost and token counts.',
}

export default function PromptsPlaygroundDocs() {
  return (
    <div>
      <h1>Prompts Playground</h1>
      <p className="lead">
        Like a SQL query console for prompts — select a version, adjust model, temperature, and
        variables, then click <strong>Run</strong> to get an immediate result with cost and token
        counts. Verify how a prompt actually behaves before deploying it to production.
      </p>

      <h2>How to use</h2>
      <ol>
        <li>
          Click a prompt name on <a href="/prompts">/prompts</a>.
        </li>
        <li>
          Select the <strong>Playground</strong> sub-tab.
        </li>
        <li>
          Choose the <strong>version</strong> to run from the dropdown.
        </li>
        <li>
          Set <strong>Model</strong>, <strong>Temperature</strong>, and <strong>Max Tokens</strong>.
        </li>
        <li>
          If the prompt content contains <code>{'{{variableName}}'}</code> placeholders, a
          Variables input form appears automatically. Fill in the values.
        </li>
        <li>
          Click <strong>Run</strong>.
        </li>
        <li>
          The result panel shows the response text, token counts, cost, and latency.
        </li>
      </ol>

      <h2>Variable interpolation</h2>
      <p>
        Placeholders in the format <code>{'{{variableName}}'}</code> in the prompt body are
        replaced at run time by the corresponding value from the <strong>variables</strong> object.
        For example:
      </p>
      <CodeBlock language="text">{`You are a {{language}} expert. Please answer {{userName}}'s question.`}</CodeBlock>
      <p>
        With <code>language: &quot;TypeScript&quot;</code> and <code>userName: &quot;Alice&quot;</code>, the text
        actually sent to the model is:
      </p>
      <CodeBlock language="text">{`You are a TypeScript expert. Please answer Alice's question.`}</CodeBlock>
      <p>
        Placeholders present in the template but missing from the variables input are returned in
        the <code>missingVars</code> array in the response. Those slots are replaced with an empty
        string and the run proceeds.
      </p>

      <h2>Supported providers</h2>
      <p>The Playground currently supports:</p>
      <ul>
        <li><strong>OpenAI</strong> — GPT model family</li>
        <li><strong>Anthropic</strong> — Claude model family</li>
      </ul>
      <p>
        Runs use your own <strong>provider key</strong> stored in Spanlens. The cost of each run
        is billed directly to your provider account — Spanlens does not cover it.
      </p>

      <h2>Run parameters</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Type</th>
              <th>Default</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>promptVersionId</code></td>
              <td>string (UUID)</td>
              <td>—</td>
              <td>ID of the prompt version to run (required)</td>
            </tr>
            <tr>
              <td><code>providerKeyId</code></td>
              <td>string (UUID)</td>
              <td>—</td>
              <td>Provider key to use (required)</td>
            </tr>
            <tr>
              <td><code>model</code></td>
              <td>string</td>
              <td>—</td>
              <td>Model to run (e.g. <code>gpt-4o-mini</code>, <code>claude-3-5-haiku-20241022</code>)</td>
            </tr>
            <tr>
              <td><code>temperature</code></td>
              <td>number</td>
              <td>0.7</td>
              <td>0–2. Lower is more deterministic; higher is more creative.</td>
            </tr>
            <tr>
              <td><code>maxTokens</code></td>
              <td>integer</td>
              <td>1024</td>
              <td>1–8192. Maximum tokens in the response.</td>
            </tr>
            <tr>
              <td><code>variables</code></td>
              <td>object</td>
              <td>{'{}'}</td>
              <td>Values to substitute for <code>{'{{key}}'}</code> placeholders in the prompt</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Response structure</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>responseText</code></td>
              <td>string</td>
              <td>The model&apos;s generated response text</td>
            </tr>
            <tr>
              <td><code>model</code></td>
              <td>string</td>
              <td>Actual model used (including provider-returned dated variant)</td>
            </tr>
            <tr>
              <td><code>promptTokens</code></td>
              <td>integer</td>
              <td>Input token count</td>
            </tr>
            <tr>
              <td><code>completionTokens</code></td>
              <td>integer</td>
              <td>Output token count</td>
            </tr>
            <tr>
              <td><code>totalTokens</code></td>
              <td>integer</td>
              <td>Input + output total</td>
            </tr>
            <tr>
              <td><code>costUsd</code></td>
              <td>number | null</td>
              <td>Estimated cost for this run (USD). Null if the model is not in the price table.</td>
            </tr>
            <tr>
              <td><code>latencyMs</code></td>
              <td>integer</td>
              <td>Time from first request to response complete (ms)</td>
            </tr>
            <tr>
              <td><code>missingVars</code></td>
              <td>string[]</td>
              <td>
                Placeholder names present in the template but absent from <code>variables</code>.
                Empty array means all variables were supplied.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Rate limit</h2>
      <p>
        The Playground endpoint is capped at <strong>20 requests per user per 60 seconds</strong>.
        Exceeding this returns <code>429 Too Many Requests</code>. For automated pipelines, use{' '}
        <a href="/docs/features/experiments">Experiments</a> instead.
      </p>

      <h2>Notes</h2>
      <ul>
        <li>
          <strong>Playground runs are not saved to the <code>requests</code> table.</strong>{' '}
          They do not appear on the Requests page or in the Prompts Calls tab, and have no effect
          on production metrics.
        </li>
        <li>
          <strong>Cost is billed to your provider key.</strong> It does not count against your
          Spanlens plan usage.
        </li>
        <li>
          If no provider key is registered, the run will fail. Go to{' '}
          <a href="/settings/keys">Provider Keys</a> to add one first.
        </li>
      </ul>

      <h2>API</h2>
      <CodeBlock language="bash">{`POST /api/v1/prompts-playground/run`}</CodeBlock>
      <p>Auth: JWT (<code>Authorization: Bearer $SPANLENS_JWT</code>)</p>

      <h3>Request example</h3>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/prompts-playground/run \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "promptVersionId": "ae1c3c1e-99eb-4f2a-b821-000000000001",
    "providerKeyId":   "b2d9f3a0-1234-5678-abcd-000000000002",
    "model": "gpt-4o-mini",
    "temperature": 0.5,
    "maxTokens": 512,
    "variables": {
      "language": "TypeScript",
      "userName": "Alice"
    }
  }'`}</CodeBlock>

      <h3>Response example</h3>
      <CodeBlock language="json">{`{
  "responseText": "TypeScript is a statically typed superset of JavaScript...",
  "model": "gpt-4o-mini-2024-07-18",
  "promptTokens": 48,
  "completionTokens": 132,
  "totalTokens": 180,
  "costUsd": 0.000054,
  "latencyMs": 812,
  "missingVars": []
}`}</CodeBlock>

      <h3>Response with missing variables</h3>
      <CodeBlock language="json">{`{
  "responseText": "Hello, . How can I help you today?",
  "model": "gpt-4o-mini-2024-07-18",
  "promptTokens": 42,
  "completionTokens": 89,
  "totalTokens": 131,
  "costUsd": 0.000039,
  "latencyMs": 654,
  "missingVars": ["userName"]
}`}</CodeBlock>
      <p>
        When <code>missingVars</code> is non-empty, those placeholders were replaced with an empty
        string. Fill in the missing values in the Variables form and re-run.
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/prompts">Prompts</a> (version management + A/B comparison),{' '}
        <a href="/docs/features/experiments">Experiments</a> (offline dataset comparison),{' '}
        <a href="/docs/features/evals">Evals</a> (LLM-as-judge quality scoring),{' '}
        <a href="/prompts">/prompts</a> dashboard.
      </p>
    </div>
  )
}
