import { openGraphFor } from '@/lib/page-metadata'
import { CodeBlock } from '../_components/code-block'
import { DocsJsonLd } from '../_components/docs-jsonld'

export const metadata = {
  title: 'Your first customer cost breakdown · Spanlens Docs',
  description: 'Send three tagged OpenAI requests, verify your first logs, and compare cost by customer and feature in Spanlens.',
  alternates: { canonical: '/docs/customer-cost-walkthrough' },
  openGraph: openGraphFor('/docs/customer-cost-walkthrough'),
}

export default function CustomerCostWalkthrough() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Your first customer cost breakdown</h1>
      <p className="lead">
        Send three short requests for two example customers, then see which customer
        and feature generated the cost. Use synthetic data to verify the setup before
        connecting your application.
      </p>

      <h2 id="setup">1. Prepare your project</h2>
      <ol>
        <li><a href="/signup">Create an account</a> and finish workspace setup.</li>
        <li>Open <a href="/projects">Projects</a> and create a full Spanlens key for your project. Save the key when it is shown.</li>
        <li>Add an OpenAI provider key under that same Spanlens key.</li>
      </ol>
      <p>
        Use Node.js 20.6 or later. Download the <a href="/examples/customer-cost.mjs" download>customer-cost.mjs example</a> into
        a new local folder. It uses Node&apos;s built-in fetch and needs no package installation.
      </p>

      <h2 id="preview">2. Preview the calls</h2>
      <CodeBlock language="bash">{'node customer-cost.mjs --dry-run'}</CodeBlock>
      <p>The preview sends no requests and needs no credentials.</p>
      <table>
        <thead><tr><th>Customer</th><th>Feature</th><th>Requests</th></tr></thead>
        <tbody>
          <tr><td>example-customer-a</td><td>support-reply</td><td>1</td></tr>
          <tr><td>example-customer-a</td><td>summarize</td><td>1</td></tr>
          <tr><td>example-customer-b</td><td>support-reply</td><td>1</td></tr>
        </tbody>
      </table>

      <h2 id="run">3. Send your first requests</h2>
      <p>Create a local <code>.env</code> file beside the script. Keep this file out of version control.</p>
      <CodeBlock language="env">{`SPANLENS_API_KEY=sl_live_your_full_project_key
# Optional: choose another chat-completions model available to your OpenAI account.
SPANLENS_EXAMPLE_MODEL=gpt-4o-mini`}</CodeBlock>
      <CodeBlock language="bash">{'node --env-file=.env customer-cost.mjs'}</CodeBlock>
      <p>
        This sends three real OpenAI requests; standard provider charges apply. Each
        response is capped at 64 output tokens. The script uses synthetic customer IDs
        and metadata-only logging, so prompt and response bodies are not stored by Spanlens.
      </p>

      <h2 id="verify">4. Verify the request rows</h2>
      <p>
        Open <a href="/requests">Requests</a> in the same workspace and project. After
        logging completes, look for the three calls and check their model, tokens,
        cost, User, and Session. Refresh if the rows have not arrived yet.
      </p>
      <ul>
        <li>HTTP 401/403: check that the Spanlens key is active and full-scope.</li>
        <li>Provider-key error: register the OpenAI key under the Spanlens key used by this script.</li>
        <li>Model-access error: choose a model your OpenAI account can call.</li>
        <li>HTTP 429: check both provider limits and Spanlens quota.</li>
        <li>A call completed but no row appeared: check project and date filters, then follow the <a href="/docs/quick-start#verify">quick-start verification steps</a>.</li>
      </ul>
      <p>For a timeout or partial failure, check the request log before running again. The example does not automatically retry calls.</p>

      <h2 id="value">5. Find the customer and feature behind the cost</h2>
      <ol>
        <li>Open <a href="/users">Users</a> and find the two example customers. Compare their request counts, tokens, and total cost over the same date range.</li>
        <li>Open <a href="/requests?userId=example-customer-a">customer A&apos;s requests</a>. Inspect Session to distinguish <code>support-reply</code> from <code>summarize</code>.</li>
        <li>Open a request to inspect its token and cost breakdown. Export the filtered requests when you need a report.</li>
      </ol>
      <p>
        Customer A has two calls and customer B has one. Actual costs depend on token
        usage and the selected model. This example demonstrates attribution; it does
        not represent customer adoption or measured savings.
      </p>

      <h2 id="application">6. Apply the same tags to your application</h2>
      <p>Use a stable internal customer ID and a session ID that identifies a feature run.</p>
      <CodeBlock language="ts">{`import { createOpenAI, withUser, withSession, withLogBody } from '@spanlens/sdk/openai'

const openai = createOpenAI()
await openai.chat.completions.create(
  {
    model: 'gpt-4o-mini',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Write a short support reply.' }],
  },
  {
    headers: {
      ...withUser('your-internal-customer-id').headers,
      ...withSession('support-reply:your-run-id').headers,
      ...withLogBody('meta').headers,
    },
  },
)`}</CodeBlock>
      <p>
        Install <code>@spanlens/sdk</code> and <code>openai</code> in your application.
        Start with one feature, review its actual costs, and decide what to investigate
        next. See the <a href="/docs/features/users">customer analytics guide</a> for the dashboard details.
      </p>
    </div>
  )
}
