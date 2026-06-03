import { CodeBlock } from '../../_components/code-block'
import { LangTabs } from '../../_components/lang-tabs'

export const metadata = {
  title: 'Migrate from LangSmith to Spanlens · 2026 Guide',
  description:
    'Move from LangSmith to Spanlens in under 45 minutes. traceable decorator to observe() mapping, LangChain callback swap, and Run / Project / Dataset to Spanlens schema.',
  alternates: { canonical: '/docs/migrate/from-langsmith' },
}

export default function MigrateFromLangsmith() {
  return (
    <div>
      <h1>Migrate from LangSmith · 2026</h1>
      <p className="lead">
        LangSmith is tightly bound to the LangChain ecosystem. Spanlens speaks the same
        graph-aware tracing shape but is provider-neutral: you can run it on plain OpenAI
        calls, LangChain, LangGraph, Vercel AI SDK, or raw HTTP from any language.
        This page shows how to swap the two without rewriting your chains.
      </p>

      <h2>Why teams switch</h2>
      <ul>
        <li>
          <strong>No framework lock-in.</strong> The Spanlens proxy works whether or not you
          use LangChain. Most teams end up with a mix of LangChain chains and direct OpenAI
          calls; LangSmith only sees the LangChain half by default.
        </li>
        <li>
          <strong>Drop-in proxy adds zero-instrumentation paths.</strong> Background workers,
          third-party libraries, MCP servers all get logged automatically once they share
          the SDK or base URL. With LangSmith you have to thread <code>@traceable</code>{' '}
          through everything.
        </li>
        <li>
          <strong>Cost and token tracking on every call.</strong> Spanlens computes cost from
          a versioned price table and stores cost_usd directly on the request row, no
          downstream aggregation step needed.
        </li>
        <li>
          <strong>MIT self-host.</strong> One Docker compose, your Supabase + ClickHouse.
        </li>
      </ul>

      <h2>Step 1. Install</h2>
      <LangTabs
        ts={`pnpm add @spanlens/sdk`}
        py={`pip install spanlens
pip install "spanlens[openai]"  # plus other provider extras as needed`}
      />

      <h2>Step 2. Swap LangChain / LangGraph tracing</h2>
      <p>
        If you use LangChain or LangGraph today, this is the smallest change. Replace the
        ambient <code>LANGSMITH_TRACING=true</code> env-var setup with an explicit Spanlens
        callback handler.
      </p>
      <p className="text-sm text-muted-foreground">Before (LangSmith, env-var driven):</p>
      <CodeBlock language="bash">{`# .env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=ls__xxx
LANGSMITH_PROJECT=my-app
LANGSMITH_ENDPOINT=https://api.smith.langchain.com`}</CodeBlock>
      <CodeBlock language="ts">{`// chains.ts
import { ChatOpenAI } from '@langchain/openai'

const llm = new ChatOpenAI({ model: 'gpt-4o-mini' })
// LangSmith picks up every call automatically via the env vars above.`}</CodeBlock>

      <p className="text-sm text-muted-foreground">After (Spanlens callback handler):</p>
      <CodeBlock language="bash">{`# .env
SPANLENS_API_KEY=sl_live_xxx`}</CodeBlock>
      <CodeBlock language="ts">{`// chains.ts
import { ChatOpenAI } from '@langchain/openai'
import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'

const client = new SpanlensClient()
const handler = createSpanlensCallbackHandler({ client })

const llm = new ChatOpenAI({ model: 'gpt-4o-mini' })

// Attach the handler at invocation time:
const res = await chain.invoke({ input }, { callbacks: [handler] })

// Or for LangGraph:
const graph = workflow.compile()
const res = await graph.invoke({ input }, { callbacks: [handler] })`}</CodeBlock>
      <p>
        The handler captures LLM, chain (LangGraph node), tool, and retriever spans. The
        <code>runId</code> / <code>parentRunId</code> pair LangChain gives every callback
        becomes the Spanlens span tree, so the graph topology is preserved.
      </p>
      <p>
        Detailed walkthrough including LangGraph specifics on{' '}
        <a href="/docs/integrations/langgraph">/docs/integrations/langgraph</a>.
      </p>

      <h2>Step 3. Replace the <code>traceable</code> decorator / wrapper</h2>
      <p>
        For non-LangChain code, LangSmith uses <code>@traceable</code> (Python) or{' '}
        <code>traceable()</code> (JS) to wrap arbitrary functions into runs. The Spanlens
        equivalent is <code>observe()</code>.
      </p>
      <p className="text-sm text-muted-foreground">Before (LangSmith):</p>
      <LangTabs
        ts={`import { traceable } from 'langsmith/traceable'

const answer = traceable(
  async (input: string) => {
    const docs = await retrieve(input)
    const resp = await openai.chat.completions.create({...})
    return resp.choices[0].message.content
  },
  { name: 'answer-question' },
)`}
        py={`from langsmith import traceable

@traceable(name="answer-question")
async def answer(input: str) -> str:
    docs = await retrieve(input)
    resp = await openai.chat.completions.create(...)
    return resp.choices[0].message.content`}
      />

      <p className="text-sm text-muted-foreground">After (Spanlens):</p>
      <LangTabs
        ts={`import { SpanlensClient } from '@spanlens/sdk'
import { observe } from '@spanlens/sdk'

const client = new SpanlensClient()

async function answer(input: string) {
  const trace = client.startTrace({ name: 'answer-question' })
  try {
    const docs = await observe(trace, { name: 'retrieve' }, () => retrieve(input))
    const resp = await observe(trace, { name: 'generate', spanType: 'llm' }, () =>
      openai.chat.completions.create({...})
    )
    return resp.choices[0].message.content
  } finally {
    await trace.end()
  }
}`}
        py={`from spanlens import SpanlensClient
from spanlens.observe import observe

client = SpanlensClient()

async def answer(input: str) -> str:
    trace = client.start_trace(name="answer-question")
    try:
        docs = await observe(trace, name="retrieve", fn=lambda: retrieve(input))
        resp = await observe(trace, name="generate", span_type="llm",
                             fn=lambda: openai.chat.completions.create(...))
        return resp.choices[0].message.content
    finally:
        await trace.end()`}
      />
      <p className="text-sm text-muted-foreground">
        Nested <code>observe()</code> calls under the same parent automatically chain into a
        span tree. If you want the function-decorator ergonomics, wrap once at the entry
        point of your route handler and call ordinary functions inside; Spanlens does not
        require every leaf to be decorated.
      </p>

      <h2>Step 4. Environment variables</h2>
      <table>
        <thead>
          <tr>
            <th>LangSmith</th>
            <th>Spanlens</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>LANGSMITH_API_KEY</code></td>
            <td><code>SPANLENS_API_KEY</code></td>
            <td>Project-scoped, format <code>sl_live_*</code>.</td>
          </tr>
          <tr>
            <td><code>LANGSMITH_PROJECT</code></td>
            <td>set at key creation</td>
            <td>The Spanlens key is bound to a project; no per-call header needed.</td>
          </tr>
          <tr>
            <td><code>LANGSMITH_TRACING=true</code></td>
            <td>not needed</td>
            <td>Tracing is on whenever the SDK / callback handler is wired up.</td>
          </tr>
          <tr>
            <td><code>LANGSMITH_ENDPOINT</code></td>
            <td>SDK <code>baseURL</code> option</td>
            <td>Self-hosting? Pass <code>baseURL</code> to <code>SpanlensClient</code>.</td>
          </tr>
        </tbody>
      </table>

      <h2>Step 5. Data model mapping</h2>
      <table>
        <thead>
          <tr>
            <th>LangSmith</th>
            <th>Spanlens</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Run (llm / chain / tool / retriever)</td>
            <td>Span (span_type: llm / custom / tool / retrieval)</td>
            <td>LangChain&apos;s &quot;chain&quot; runs map to Spanlens <code>custom</code> spans; LangGraph nodes map the same way.</td>
          </tr>
          <tr>
            <td>Trace (collection of runs)</td>
            <td>Trace</td>
            <td>1:1. Spanlens trace has <code>span_count</code>, <code>total_tokens</code>, <code>total_cost_usd</code> aggregated via DB trigger.</td>
          </tr>
          <tr>
            <td>Project</td>
            <td>Project</td>
            <td>1:1. Spanlens projects also scope API keys and provider keys.</td>
          </tr>
          <tr>
            <td>Thread (session_id grouping)</td>
            <td><code>x-spanlens-session</code> header</td>
            <td>No separate Thread table; filter <a href="/requests">/requests</a> by <code>session_id</code>.</td>
          </tr>
          <tr>
            <td>Dataset / Example</td>
            <td>Dataset / Dataset Item</td>
            <td>1:1. Items accept either variable maps or raw chat messages.</td>
          </tr>
          <tr>
            <td>Feedback (score / tag)</td>
            <td>Eval result + human annotation</td>
            <td>Spanlens stores LLM-judge scores in <code>eval_results</code> and human ratings in a separate <code>human_evals</code> table.</td>
          </tr>
          <tr>
            <td>Annotation queue</td>
            <td><a href="/docs/features/annotation">Annotation</a></td>
            <td>Sample N requests, score them in a queue UI; results land in <code>human_evals</code>.</td>
          </tr>
        </tbody>
      </table>

      <h2>Step 6. Run both side-by-side during the cutover</h2>
      <p>
        LangSmith and Spanlens do not conflict. Keep LangSmith env vars in place while you
        add the Spanlens callback handler; you will see both dashboards populated.
      </p>
      <CodeBlock language="ts">{`// Both active for one chain
const langsmithEnabled = process.env.LANGSMITH_TRACING === 'true'
const handlers = langsmithEnabled
  ? [createSpanlensCallbackHandler({ client })]  // LangSmith auto-attaches
  : [createSpanlensCallbackHandler({ client })]

await chain.invoke({ input }, { callbacks: handlers })`}</CodeBlock>
      <p>
        When the Spanlens dashboard matches LangSmith for a representative slice of traffic,
        drop <code>LANGSMITH_TRACING</code>, remove the LangSmith env vars, uninstall{' '}
        <code>langsmith</code>.
      </p>

      <h2>What does not migrate 1:1</h2>
      <ul>
        <li>
          <strong>LangSmith Hub (public prompt library).</strong> Spanlens does not have a
          public hub. Your private prompt versions live in <a href="/prompts">/prompts</a>{' '}
          and are referenced by name@version through <code>x-spanlens-prompt-version</code>.
        </li>
        <li>
          <strong>RunTree low-level API.</strong> Spanlens equivalent is the
          {' '}<code>SpanlensClient.startTrace()</code> / <code>trace.span()</code> /{' '}
          <code>span.child()</code> chain. Same shape, different names.
        </li>
        <li>
          <strong>400-day retention.</strong> Spanlens retention depends on plan: 14 days
          (Free), 90 days (Pro), 365 days (Team). Self-hosting removes the cap.
        </li>
        <li>
          <strong>LangChain auto-instrumentation across language boundaries.</strong> Within
          one Node process the callback handler covers LangChain JS and LangGraph JS. For
          Python LangChain, use the Python SDK.
        </li>
      </ul>

      <h2>Verify the cutover</h2>
      <ol>
        <li>Invoke a traced chain once.</li>
        <li>
          Open <a href="/traces">/traces</a>. The span tree should mirror what LangSmith
          showed, including LangGraph node hierarchy.
        </li>
        <li>
          Open the LLM call detail. Token counts and cost should match the LangSmith run
          within 1%.
        </li>
        <li>
          If you used datasets / eval feedback in LangSmith, re-create the dataset in{' '}
          <a href="/datasets">/datasets</a> and re-run the evaluator in{' '}
          <a href="/evals">/evals</a> against the same dataset items.
        </li>
      </ol>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/integrations/langgraph">LangGraph integration</a> for graph
        topology details, or <a href="/docs/concepts/data-model">data model</a> for the
        full schema.
      </p>
    </div>
  )
}
