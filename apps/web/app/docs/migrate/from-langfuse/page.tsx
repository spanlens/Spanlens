import { CodeBlock } from '../../_components/code-block'
import { LangTabs } from '../../_components/lang-tabs'

export const metadata = {
  title: 'Migrate from Langfuse · Spanlens Docs',
  description:
    'Move from Langfuse to Spanlens in under 30 minutes. Code diffs, data model mapping, and dual-running steps so you can switch without losing history.',
  alternates: { canonical: '/docs/migrate/from-langfuse' },
}

export default function MigrateFromLangfuse() {
  return (
    <div>
      <h1>Migrate from Langfuse</h1>
      <p className="lead">
        Spanlens covers the same observability surface as Langfuse: traces, generations,
        prompts, evals, datasets. The integration is one line at the SDK level, so you can
        switch a single service in under 30 minutes. This page walks the swap end to end
        and is honest about the four spots where the two products diverge.
      </p>

      <h2>Why teams switch</h2>
      <ul>
        <li>
          <strong>Drop-in proxy.</strong> Spanlens does not require a callback handler on
          every chain. Point the OpenAI / Anthropic / Gemini base URL at the proxy and every
          call is logged, even from code paths you do not own (third-party libraries,
          background workers, MCP servers).
        </li>
        <li>
          <strong>One key per project.</strong> No public / secret key split. The same
          <code>sl_live_*</code> key authenticates the proxy and the REST API.
        </li>
        <li>
          <strong>Provider keys stored server-side.</strong> Your real OpenAI / Anthropic key
          is AES-256-GCM encrypted in our database and never lives in client code or env
          files. Langfuse stores them in your app.
        </li>
        <li>
          <strong>Simpler pricing for SaaS.</strong> Spanlens bills on logged requests and
          does not charge separately for evals or observations.
        </li>
      </ul>
      <p>
        See the full feature comparison on{' '}
        <a href="/compare/langfuse">spanlens vs langfuse</a>.
      </p>

      <h2>Step 1. Install the Spanlens SDK</h2>
      <LangTabs
        ts={`pnpm add @spanlens/sdk
# or: npm install @spanlens/sdk`}
        py={`pip install spanlens
# Provider extras as needed:
pip install "spanlens[openai]"
pip install "spanlens[anthropic]"
pip install "spanlens[gemini]"`}
      />

      <h2>Step 2. Swap the client constructor</h2>
      <p>
        The Langfuse OpenAI / Anthropic wrappers become a single Spanlens helper per
        provider. Same method signatures, same response types, drop-in.
      </p>

      <h3>OpenAI</h3>
      <p className="text-sm text-muted-foreground">Before (Langfuse):</p>
      <LangTabs
        ts={`import { OpenAI } from 'openai'
import { observeOpenAI } from 'langfuse'

const openai = observeOpenAI(new OpenAI())`}
        py={`from langfuse.openai import openai

# Langfuse-instrumented OpenAI client`}
      />
      <p className="text-sm text-muted-foreground">After (Spanlens):</p>
      <LangTabs
        ts={`import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI() // reads SPANLENS_API_KEY from env`}
        py={`from spanlens.integrations.openai import create_openai

openai = create_openai()  # reads SPANLENS_API_KEY from env`}
      />

      <h3>Anthropic</h3>
      <p className="text-sm text-muted-foreground">Before (Langfuse, manual span wrapping):</p>
      <CodeBlock language="ts">{`import Anthropic from '@anthropic-ai/sdk'
import { Langfuse } from 'langfuse'

const langfuse = new Langfuse()
const anthropic = new Anthropic()

const generation = langfuse.generation({ name: 'reply', model: 'claude-haiku-4-5' })
const msg = await anthropic.messages.create({ ... })
generation.end({ output: msg.content })`}</CodeBlock>
      <p className="text-sm text-muted-foreground">After (Spanlens):</p>
      <CodeBlock language="ts">{`import { createAnthropic } from '@spanlens/sdk/anthropic'

const anthropic = createAnthropic()
const msg = await anthropic.messages.create({ ... })
// logged automatically, no end() call`}</CodeBlock>

      <h3>LangChain / LangGraph</h3>
      <p>
        Replace the Langfuse callback handler with the Spanlens one. The contract is the
        same.
      </p>
      <CodeBlock language="ts">{`// Before
import { CallbackHandler } from 'langfuse-langchain'
const handler = new CallbackHandler()

// After
import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'

const client = new SpanlensClient()
const handler = createSpanlensCallbackHandler({ client })

await chain.invoke({ input }, { callbacks: [handler] })`}</CodeBlock>
      <p>
        See <a href="/docs/integrations/langgraph">LangGraph integration</a> for the full
        graph-topology mapping (chain.* spans become the LangGraph node tree).
      </p>

      <h2>Step 3. Update environment variables</h2>
      <table>
        <thead>
          <tr>
            <th>Langfuse</th>
            <th>Spanlens</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>LANGFUSE_PUBLIC_KEY</code></td>
            <td>none</td>
            <td>Spanlens uses a single secret key.</td>
          </tr>
          <tr>
            <td><code>LANGFUSE_SECRET_KEY</code></td>
            <td><code>SPANLENS_API_KEY</code></td>
            <td>Issued per project from <a href="/projects">/projects</a>. Format <code>sl_live_*</code>.</td>
          </tr>
          <tr>
            <td><code>LANGFUSE_HOST</code></td>
            <td>not needed on cloud</td>
            <td>Self-hosting? Pass <code>baseURL</code> to <code>createOpenAI()</code>.</td>
          </tr>
          <tr>
            <td><code>OPENAI_API_KEY</code></td>
            <td>register in dashboard</td>
            <td>Add it once under <strong>+ Add provider key</strong>. It stays server-side.</td>
          </tr>
        </tbody>
      </table>

      <h2>Step 4. Data model mapping</h2>
      <p>
        Most concepts map 1:1. Two diverge: Spanlens does not have a separate{' '}
        <em>generation</em> entity (LLM calls are logged as <em>requests</em>), and Spanlens
        does not have first-class <em>sessions</em>; conversations are grouped via the{' '}
        <code>x-spanlens-session</code> header instead.
      </p>
      <table>
        <thead>
          <tr>
            <th>Langfuse</th>
            <th>Spanlens</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Trace</td>
            <td>Trace</td>
            <td>Same shape. <code>name</code>, <code>metadata</code>, status fields all map.</td>
          </tr>
          <tr>
            <td>Observation (Span / Tool / Retrieval)</td>
            <td>Span</td>
            <td>Spanlens span types are <code>llm</code>, <code>tool</code>, <code>retrieval</code>, <code>embedding</code>, <code>custom</code>.</td>
          </tr>
          <tr>
            <td>Observation type Generation</td>
            <td>Request (LLM call) + Span (link)</td>
            <td>LLM calls live in their own column store (ClickHouse) for fast aggregation. Spans link via <code>request_id</code>.</td>
          </tr>
          <tr>
            <td>Score</td>
            <td>Eval result</td>
            <td>Spanlens has runs (one execution) and results (one score). Same 0..1 normalization.</td>
          </tr>
          <tr>
            <td>Session</td>
            <td><code>x-spanlens-session</code> header</td>
            <td>No separate Session table. Use the header on each call and filter by <code>session_id</code> in <a href="/requests">/requests</a>.</td>
          </tr>
          <tr>
            <td>User</td>
            <td><code>x-spanlens-user</code> header</td>
            <td>Same pattern. The <a href="/users">/users</a> view aggregates per <code>user_id</code>.</td>
          </tr>
          <tr>
            <td>Prompt</td>
            <td>Prompt + Prompt Version</td>
            <td>Versions are immutable. Linked via <code>x-spanlens-prompt-version</code> header (use <code>withPromptVersion()</code> helper).</td>
          </tr>
          <tr>
            <td>Dataset / Item</td>
            <td>Dataset / Dataset Item</td>
            <td>1:1. Items accept either <code>variables</code> or <code>messages</code> shape.</td>
          </tr>
        </tbody>
      </table>

      <h2>Step 5. Run both side-by-side during the cutover</h2>
      <p>
        Spanlens does not conflict with Langfuse: they instrument independently. The safest
        rollout is to leave the Langfuse callback in place, add Spanlens for a single
        service, and compare for a day or two.
      </p>
      <CodeBlock language="ts">{`// Both active
import { createOpenAI } from '@spanlens/sdk/openai'
import { observeOpenAI } from 'langfuse'

const openai = observeOpenAI(createOpenAI())
// Every call is now logged to BOTH backends. Pick whichever dashboard
// you trust, then remove the other when you are confident.`}</CodeBlock>
      <p>
        Once Spanlens looks right in your dashboard for a representative slice of traffic,
        delete the Langfuse wrapper, drop the env vars, and uninstall the SDK.
      </p>

      <h2>What does not migrate 1:1</h2>
      <ul>
        <li>
          <strong>Public-key client-side ingestion.</strong> Spanlens does not have a
          publishable key. All ingest authenticates with the project secret key. If you
          were sending events directly from a browser, route them through your backend.
        </li>
        <li>
          <strong>Self-hosted historical data.</strong> Spanlens does not import Langfuse
          history. Existing traces stay in Langfuse for read-only access; new traces flow
          into Spanlens from cutover onwards.
        </li>
        <li>
          <strong>Prompt template variables in <code>{`{{var}}`}</code> syntax.</strong>{' '}
          Spanlens prompts store the raw template and a separate <code>variables</code>{' '}
          JSON list. The template syntax is whatever you choose to render in your app.
        </li>
      </ul>

      <h2>Verify the cutover</h2>
      <ol>
        <li>Make any call from the migrated service.</li>
        <li>
          Open <a href="/requests">/requests</a>. A new row should appear within a few
          seconds with model, tokens, cost, latency, full bodies.
        </li>
        <li>
          For traced workflows, check <a href="/traces">/traces</a>. The span tree should
          mirror what Langfuse showed, with the LangGraph node topology preserved if you
          use the callback handler.
        </li>
        <li>
          Compare token counts and cost against Langfuse for one day. Differences greater
          than 1% usually indicate a model name not in the price table; email{' '}
          <a href="mailto:support@spanlens.io">support@spanlens.io</a> and we will seed it
          same day.
        </li>
      </ol>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/concepts/data-model">Data model</a> for the full schema, or{' '}
        <a href="/docs/integrations/langgraph">LangGraph integration</a> for graph-aware
        tracing.
      </p>
    </div>
  )
}
