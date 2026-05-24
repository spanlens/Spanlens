import { CodeBlock } from '../../_components/code-block'
import { DatasetSchemaDiagram } from '../../_components/diagrams'

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
          <strong>No production traffic yet</strong>, you want to evaluate a prompt before the
          first real calls accumulate.
        </li>
        <li>
          <strong>Sensitive production data</strong>, healthcare, finance, or other regulated
          domains where you need an anonymized set.
        </li>
        <li>
          <strong>Regression test set</strong>, a curated golden set of 30 past failure cases
          that every new prompt version must handle correctly.
        </li>
      </ul>

      <h2>Schema</h2>

      <DatasetSchemaDiagram />

      <h3><code>datasets</code> table</h3>
      <ul>
        <li><code>name</code>, unique within the organization</li>
        <li><code>description</code>, free text</li>
        <li><code>archived_at</code>, soft delete</li>
      </ul>

      <h3><code>dataset_items</code> table</h3>
      <ul>
        <li>
          <code>input</code> (jsonb), two shapes are accepted:
          <CodeBlock language="json">{`{ "variables": { "company_name": "Acme", "customer_name": "Alice" } }
{ "messages": [{ "role": "user", "content": "..." }] }`}</CodeBlock>
          Bulk upload also accepts a plain string for <code>input</code>; the server wraps it as a
          single user message automatically.
        </li>
        <li>
          <code>expected_output</code>, reference answer text (optional). Stored alongside the
          item but not consumed by the eval runner in this release. The runner generates a fresh
          response per item and scores that, so prompt quality is what gets measured.
        </li>
        <li>
          <code>source_request_id</code>, set when the item was imported from a production request.
        </li>
      </ul>

      <h2>Four ways to add items</h2>

      <h3>1. Manual entry (dashboard)</h3>
      <p>
        Go to <a href="/datasets">/datasets</a>, select a dataset, click{' '}
        <strong>Add item</strong>, then toggle between two input modes:
      </p>
      <ul>
        <li><strong>User message</strong>, a single chat-style user message</li>
        <li><strong>Variables JSON</strong>, for prompts with <code>{`{{var}}`}</code> placeholders</li>
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

      <h3>4. File upload from the Eval Run dialog</h3>
      <p>
        On the Eval Run dialog, switch <strong>Sample source</strong> to <strong>Dataset</strong>,
        click the <strong>Plus Upload</strong> button next to the picker, and choose a JSON or
        CSV file. The file is parsed in the browser (no external deps), a fresh dataset with an
        auto generated name is created (for example <code>upload-2026-05-22-2245</code>), every
        valid row is inserted in one bulk call, and the new dataset is pre selected so you can
        click Run immediately.
      </p>
      <p>Accepted file shapes:</p>
      <ul>
        <li>
          <strong>JSON</strong>, an array of <code>{`{ input, expected_output? }`}</code> objects.{' '}
          <code>input</code> can be a plain string (wrapped as a one message conversation),{' '}
          <code>{`{ messages: [...] }`}</code>, or <code>{`{ variables: {...} }`}</code>.
        </li>
        <li>
          <strong>CSV</strong>, header row with <code>input</code> (required) and{' '}
          <code>expected_output</code> (optional). Quoted fields are supported.
        </li>
      </ul>
      <p>
        The dataset stays in <a href="/datasets">/datasets</a> for later reuse. Rename it (so you
        can find it months later), keep it as is, or delete it after the run.
      </p>
      <p>Behind the scenes the upload calls:</p>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/api/v1/datasets/<dataset-id>/items/bulk \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{ "items": [ { "input": "..." }, ... ] }'`}</CodeBlock>
      <p>
        Max 5000 items per request. Rows the server cannot normalize (missing or wrong shape){' '}
        come back in a <code>skipped</code> array with per row reasons instead of failing the
        whole batch.
      </p>

      <h2>Connection to Evals</h2>
      <p>
        When running an Eval, select <strong>Source: Dataset</strong>, then pick a{' '}
        <strong>Run provider</strong> and <strong>Run model</strong>. The eval runner does this
        per item: take the dataset <code>input</code>, run it through the chosen prompt version
        with that run model, then send the generated response to the judge for scoring.
      </p>
      <p>
        Older releases scored the dataset&apos;s <code>expected_output</code> text directly. That
        measured how friendly the curated reference text was, not how the prompt actually
        behaves, so it was replaced. <code>expected_output</code> is stored but unused by the
        runner in the current release.
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
            <td><code>POST /api/v1/datasets/:id/items/bulk</code></td>
            <td>Bulk insert pre parsed items (max 5000). Used by the Eval Run dialog file upload.</td>
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
          <strong>No item edit UI.</strong> To correct a wrongly entered item, delete it and
          add a new one.
        </li>
        <li>
          <strong>Bulk upload limit is 5000 items.</strong> Larger sets must be split across
          multiple calls.
        </li>
        <li>
          <strong><code>expected_output</code> is reference only.</strong> The eval runner does
          not currently feed it to the judge as a target. A future release may add a similarity
          mode that uses it.
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
