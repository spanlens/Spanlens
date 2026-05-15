import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Datasets · Spanlens Docs',
  description:
    'Reusable (input, expected_output) test sets. Use in Evals and Experiments instead of pulling from live production traffic.',
}

export default function DatasetsDocs() {
  return (
    <div>
      <h1>Datasets</h1>
      <p className="lead">
        Named collections of <code>(input, expected_output?)</code> pairs.{' '}
        <a href="/docs/features/evals">Evals</a> and{' '}
        <a href="/docs/features/experiments">Experiments</a> can use a dataset instead of sampling
        from live production traffic when you want evaluations against a fixed, controlled input
        set.
      </p>

      <h2>When to use a dataset</h2>
      <ul>
        <li>
          <strong>No production traffic yet</strong> — you want to evaluate a prompt before the
          first real calls accumulate.
        </li>
        <li>
          <strong>Sensitive production data</strong> — healthcare, finance, or other regulated
          domains where you need an anonymized set.
        </li>
        <li>
          <strong>Regression test set</strong> — a curated golden set of 30 past failure cases
          that every new prompt version must handle correctly.
        </li>
      </ul>

      <h2>Schema</h2>

      <h3><code>datasets</code> table</h3>
      <ul>
        <li><code>name</code> — unique within the organization</li>
        <li><code>description</code> — free text</li>
        <li><code>archived_at</code> — soft delete</li>
      </ul>

      <h3><code>dataset_items</code> table</h3>
      <ul>
        <li>
          <code>input</code> (jsonb) — two shapes are accepted:
          <CodeBlock language="json">{`{ "variables": { "company_name": "Acme", "customer_name": "Alice" } }
{ "messages": [{ "role": "user", "content": "..." }] }`}</CodeBlock>
        </li>
        <li>
          <code>expected_output</code> — reference answer text (optional). Used as the scoring
          target when running Evals in dataset mode. Items without a value are skipped.
        </li>
        <li>
          <code>source_request_id</code> — set when the item was imported from a production request.
        </li>
      </ul>

      <h2>Three ways to add items</h2>

      <h3>1. Manual entry (dashboard)</h3>
      <p>
        Go to <a href="/datasets">/datasets</a>, select a dataset, click{' '}
        <strong>Add item</strong>, then toggle between two input modes:
      </p>
      <ul>
        <li><strong>User message</strong> — a single chat-style user message</li>
        <li><strong>Variables JSON</strong> — for prompts with <code>{`{{var}}`}</code> placeholders</li>
      </ul>

      <h3>2. Import from production requests (API)</h3>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/datasets/<dataset-id>/items/import-requests \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{ "requestIds": ["uuid-1", "uuid-2", ...] }'`}</CodeBlock>
      <p>
        The server extracts <code>request_body.messages</code> as <code>input</code> and the
        response text as <code>expected_output</code> and saves them in bulk (max 200 per request).
      </p>

      <h3>3. Single item (API)</h3>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/datasets/<dataset-id>/items \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "input": { "variables": { "name": "Alice" } },
    "expectedOutput": "Hello Alice, how can I help?"
  }'`}</CodeBlock>

      <h2>Connection to Evals (replay mode)</h2>
      <p>
        When running an Eval, select <strong>Source: Dataset</strong> to score the dataset&apos;s{' '}
        <code>expected_output</code> values instead of live production responses. Items without an{' '}
        <code>expected_output</code> are skipped.
      </p>
      <p>
        This is called &quot;replay mode&quot; — scoring already-generated outputs.{' '}
        <em>Fresh run mode</em> (run the prompt against each dataset input and then score the new
        outputs) is handled by <a href="/docs/features/experiments">Experiments</a>.
      </p>

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
            <td><code>POST /api/v1/datasets</code></td>
            <td>Create a dataset</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/datasets</code></td>
            <td>List datasets with item_count</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/datasets/:id</code></td>
            <td>Dataset with all items</td>
          </tr>
          <tr>
            <td><code>DELETE /api/v1/datasets/:id</code></td>
            <td>Soft archive</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/datasets/:id/items</code></td>
            <td>Add a single item</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/datasets/:id/items/import-requests</code></td>
            <td>Bulk import from request IDs (max 200)</td>
          </tr>
          <tr>
            <td><code>DELETE /api/v1/datasets/:id/items/:itemId</code></td>
            <td>Delete a single item</td>
          </tr>
        </tbody>
      </table>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>No CSV upload.</strong> Items must be added via the dashboard form or the API.
          CSV import is planned for a later release.
        </li>
        <li>
          <strong>Evals dataset source is replay mode only.</strong> Fresh-run evaluation
          (running the prompt live against dataset inputs) is handled by Experiments.
        </li>
        <li>
          <strong>No item edit UI.</strong> To correct a wrongly entered item, delete it and
          add a new one.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/evals">Evals</a>,{' '}
        <a href="/docs/features/experiments">Experiments</a>,{' '}
        <a href="/datasets">/datasets</a> dashboard.
      </p>
    </div>
  )
}
