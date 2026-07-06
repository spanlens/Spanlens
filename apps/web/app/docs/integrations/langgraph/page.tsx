import { CodeBlock } from '../../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  title: 'LangGraph integration · Spanlens Docs',
  description:
    'Trace LangGraph node and edge execution with Spanlens. One callback handler captures the full graph topology, parallel fan-out, and tool calls.',
  alternates: { canonical: '/docs/integrations/langgraph' },
}

export default function LangGraphIntegration() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>LangGraph integration</h1>
      <p className="lead">
        LangGraph reuses LangChain&apos;s callback contract, so the same Spanlens handler
        works for both. Every node invocation becomes a span; the <code>runId</code> and{' '}
        <code>parentRunId</code> on each callback give Spanlens the graph topology, which
        renders in two ways on <a href="/traces">/traces</a>: as a Gantt waterfall (Timeline
        tab) and as a node-and-edge graph (Graph tab) with the critical path highlighted in
        accent color.
      </p>

      <h2>Install</h2>
      <CodeBlock language="bash">{`pnpm add @spanlens/sdk
# plus your existing langgraph install:
pnpm add @langchain/langgraph @langchain/core`}</CodeBlock>

      <h2>Minimal setup</h2>
      <CodeBlock language="ts">{`import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'
import { StateGraph, END } from '@langchain/langgraph'

const client = new SpanlensClient()
const handler = createSpanlensCallbackHandler({ client })

const workflow = new StateGraph(...)
  .addNode('retrieve', retrieveNode)
  .addNode('generate', generateNode)
  .addNode('reflect', reflectNode)
  .addConditionalEdges('reflect', shouldContinue, { yes: 'retrieve', no: END })

const graph = workflow.compile()

// Attach at invocation time:
const result = await graph.invoke(
  { input: question },
  { callbacks: [handler] },
)`}</CodeBlock>
      <p>
        That is the whole integration. The handler is safe to share across concurrent
        invocations (LangChain tags every run with a UUID), so one instance per process is
        fine.
      </p>

      <h2>What gets captured</h2>
      <table>
        <thead>
          <tr>
            <th>LangGraph event</th>
            <th>Spanlens span</th>
            <th>Default capture?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Graph node entry / exit</td>
            <td><code>chain.&lt;node_name&gt;</code>, span_type <code>custom</code></td>
            <td>yes</td>
          </tr>
          <tr>
            <td>LLM call (ChatModel or LLM)</td>
            <td><code>llm.&lt;model_class&gt;</code>, span_type <code>llm</code> with token usage</td>
            <td>yes</td>
          </tr>
          <tr>
            <td>Tool call</td>
            <td><code>tool.&lt;tool_name&gt;</code>, span_type <code>tool</code></td>
            <td>yes</td>
          </tr>
          <tr>
            <td>Retriever query</td>
            <td><code>retrieval.&lt;retriever_name&gt;</code>, span_type <code>retrieval</code></td>
            <td>yes</td>
          </tr>
          <tr>
            <td>Conditional edge evaluation</td>
            <td>captured as a child <code>chain.*</code> span on the source node</td>
            <td>yes</td>
          </tr>
          <tr>
            <td>State channel updates</td>
            <td>not captured (would be too noisy on most graphs)</td>
            <td>no</td>
          </tr>
        </tbody>
      </table>
      <p>
        Toggle individual capture categories on the handler:
      </p>
      <CodeBlock language="ts">{`const handler = createSpanlensCallbackHandler({
  client,
  captureChains: true,      // nodes + conditional edges (default true)
  captureTools: true,       // tool calls (default true)
  captureRetrieval: true,   // retriever spans (default true)
  maxInputBytes: 16_384,    // truncate large inputs at 16 KB
  maxOutputBytes: 16_384,
})`}</CodeBlock>

      <h2>Parallel fan-out (Send API, parallel branches)</h2>
      <p>
        LangGraph&apos;s <code>Send</code> primitive and parallel conditional edges fire
        multiple nodes concurrently. Spanlens spans intentionally do not enforce a foreign
        key on <code>parent_span_id</code>, so out-of-order child closes never break the
        tree. The waterfall view stacks parallel branches vertically with their actual
        start / end timestamps.
      </p>
      <CodeBlock language="text">{`Trace: customer-support-agent  (3.2s)
└── chain.agent_orchestrator           (3.2s)
    ├── chain.classify_intent          (450ms)
    │   └── llm.ChatOpenAI             (430ms, gpt-4o-mini, $0.0008)
    │
    ├── chain.dispatch (parallel)      (2.7s)
    │   ├── chain.lookup_order         (1.1s)
    │   │   ├── tool.shopify_query     (840ms)
    │   │   └── llm.ChatOpenAI         (240ms, gpt-4o-mini, $0.0005)
    │   │
    │   └── chain.lookup_kb            (2.7s)        ← critical path
    │       ├── retrieval.PineconeStore (300ms, 12 docs)
    │       └── llm.ChatAnthropic       (2.3s, claude-haiku-4-5, $0.0023)
    │
    └── chain.compose_final            (40ms)`}</CodeBlock>

      <h2>Attaching to a long-lived trace</h2>
      <p>
        By default the handler opens a fresh trace for each top-level <code>invoke()</code>{' '}
        call and closes it when the root run ends. To group multiple invocations (for
        example: every turn of a chat session) under one trace, pass an existing trace:
      </p>
      <CodeBlock language="ts">{`const trace = client.startTrace({
  name: 'chat-session',
  metadata: { user_id: currentUser.id, session_id: sessionId },
})

const handler = createSpanlensCallbackHandler({ client, trace })

// All turns in this session attach as child spans under one trace.
for (const userMessage of conversation) {
  await graph.invoke({ input: userMessage }, { callbacks: [handler] })
}

await trace.end()   // caller owns lifecycle when trace is passed in`}</CodeBlock>

      <h2>Pairing with the proxy for cost / token capture</h2>
      <p>
        The callback handler captures span structure but takes token counts from
        LangChain&apos;s <code>llmOutput.tokenUsage</code>, which is sometimes empty on
        streaming responses. To guarantee accurate cost on every LLM call, configure
        LangChain&apos;s OpenAI / Anthropic providers to route through the Spanlens proxy:
      </p>
      <CodeBlock language="ts">{`import { ChatOpenAI } from '@langchain/openai'

const llm = new ChatOpenAI({
  model: 'gpt-4o-mini',
  configuration: {
    baseURL: 'https://server.spanlens.io/proxy/openai/v1',
    apiKey: process.env.SPANLENS_API_KEY,
  },
})`}</CodeBlock>
      <p>
        Now every LLM call lands as a Request in ClickHouse with the canonical cost and
        token counts, and the corresponding LLM span links to it via{' '}
        <code>request_id</code>. The trace waterfall shows both: the structural span tree
        from the callback handler and authoritative cost from the proxy log.
      </p>

      <h2>Linking spans to prompt versions</h2>
      <p>
        To tag an LLM call inside the graph with a Spanlens prompt version, set the
        <code>x-spanlens-prompt-version</code> header on the underlying request. With the
        proxy approach above, attach it as a default header:
      </p>
      <CodeBlock language="ts">{`const llm = new ChatOpenAI({
  model: 'gpt-4o-mini',
  configuration: {
    baseURL: 'https://server.spanlens.io/proxy/openai/v1',
    apiKey: process.env.SPANLENS_API_KEY,
    defaultHeaders: {
      'x-spanlens-prompt-version': 'agent-system@7',
    },
  },
})`}</CodeBlock>
      <p>
        The Request row now carries <code>prompt_version_id</code>, so the Prompt A/B view
        can compare versions on production traffic.
      </p>

      <h2>Verifying the integration</h2>
      <ol>
        <li>Invoke the graph once.</li>
        <li>
          Open <a href="/traces">/traces</a>. A new trace appears with the graph
          name (default <code>langchain_run</code>; override via <code>traceName</code>).
        </li>
        <li>
          Click into the trace. The waterfall mirrors your graph: one row per node, nested
          tool / LLM / retrieval children, parallel branches stacked at their real times.
        </li>
        <li>
          On any LLM row, the right panel shows token counts and cost. If <code>request_id</code>{' '}
          is present, the row links straight to the Request in <a href="/requests">/requests</a>.
        </li>
      </ol>

      <h2>Troubleshooting</h2>

      <h3>No spans show up</h3>
      <p>
        Make sure you pass the handler at <em>invocation</em> time (in the
        <code>callbacks</code> option of <code>graph.invoke()</code>), not at compile time.
        LangGraph compiles the graph once but invokes it many times; the handler must travel
        with each invocation.
      </p>

      <h3>LLM spans missing token usage</h3>
      <p>
        Streaming responses sometimes omit <code>tokenUsage</code> in
        <code>llmOutput</code>. The fix is to route the underlying LLM through the Spanlens
        proxy (see <em>Pairing with the proxy</em> above); the proxy parses tokens from the
        raw stream and the linked Request always has them.
      </p>

      <h3>Trace closes too early on background work</h3>
      <p>
        If your graph kicks off fire-and-forget work after returning, the auto-managed
        trace will close before that work logs. Pass an external trace and call{' '}
        <code>trace.end()</code> yourself when all work is done.
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/tutorials/agent-tracing">Agent tracing tutorial</a> for a
        runnable example, or <a href="/docs/concepts/data-model">data model</a> for what
        ends up in the database.
      </p>
    </div>
  )
}
