import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Multi-step agent tracing · Spanlens Docs',
  description:
    'Tutorial: trace an agent that classifies intent, fans out to parallel tools, and composes an answer. Per-step cost and critical path in one waterfall.',
  alternates: { canonical: '/docs/tutorials/agent-tracing' },
}

export default function AgentTracingTutorial() {
  return (
    <div>
      <h1>Tutorial: trace a multi-step agent</h1>
      <p className="lead">
        Thirty minutes. We trace an agent that classifies a user message, dispatches to
        two parallel tools, and composes a final response. By the end you can answer
        which step ate the wall-clock and which call ate the cost, even when steps run
        concurrently.
      </p>

      <h2>What you will end up with</h2>
      <ul>
        <li>One trace per agent invocation in <a href="/traces">/traces</a>.</li>
        <li>Parallel branches stacked vertically with their real start / end times.</li>
        <li>Critical path highlighted (the longest chain that gates the final answer).</li>
        <li>Per-step cost rolled up to the trace total.</li>
      </ul>

      <h2>The agent we are tracing</h2>
      <p>
        A customer-support agent. Given a user message it:
      </p>
      <ol>
        <li>Classifies intent (LLM call)</li>
        <li>
          Based on intent, fans out two lookups in parallel:
          <ul>
            <li>Order lookup (Shopify API tool + summarizer LLM)</li>
            <li>Knowledge base lookup (Pinecone retrieval + answerer LLM)</li>
          </ul>
        </li>
        <li>Composes a final response from both branches (LLM call)</li>
      </ol>
      <p>
        We will write this without LangChain to keep the example portable. The same
        pattern works for LangGraph; see{' '}
        <a href="/docs/integrations/langgraph">LangGraph integration</a> for the callback
        handler version.
      </p>

      <h2>Step 1. Set up</h2>
      <CodeBlock language="bash">{`pnpm add @spanlens/sdk`}</CodeBlock>
      <CodeBlock language="env">{`SPANLENS_API_KEY=sl_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>
      <p>
        Register your OpenAI provider key in <a href="/projects">/projects</a> as usual.
      </p>

      <h2>Step 2. Bootstrap the trace</h2>
      <p>
        One trace per agent invocation. All work hangs off this trace.
      </p>
      <CodeBlock language="ts">{`import { SpanlensClient, observe } from '@spanlens/sdk'
import { createOpenAI } from '@spanlens/sdk/openai'

const client = new SpanlensClient()
const openai = createOpenAI()

export async function handleSupportMessage(message: string, userId: string) {
  const trace = client.startTrace({
    name: 'support-agent',
    metadata: { user_id: userId },
  })

  try {
    // ... steps go here ...
  } finally {
    await trace.end()
  }
}`}</CodeBlock>

      <h2>Step 3. Classify the intent</h2>
      <p>
        Wrap the classification LLM call so it shows up as a child span of the trace. The
        proxy already emits an LLM span automatically; <code>observe()</code> here gives
        us a meaningful name (<code>classify_intent</code>) and groups the call under the
        trace explicitly.
      </p>
      <CodeBlock language="ts">{`type Intent = 'order_status' | 'general_question'

const intent = await observe(
  trace,
  { name: 'classify_intent', spanType: 'llm', input: { message } },
  async () => {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Classify the user message. Reply with exactly: order_status OR general_question.' },
        { role: 'user', content: message },
      ],
    })
    return res.choices[0].message.content?.trim() as Intent
  },
)`}</CodeBlock>

      <h2>Step 4. Fan out two parallel branches</h2>
      <p>
        Parallel branches in Spanlens are first-class. Each branch is its own{' '}
        <code>observe()</code> call; <code>Promise.all</code> runs them concurrently, and
        the waterfall shows them stacked with their real start / end times.
      </p>
      <CodeBlock language="ts">{`const [orderInfo, kbAnswer] = await Promise.all([
  observe(trace, { name: 'lookup_order', spanType: 'custom' }, async (span) => {
    // child span: shopify tool call
    const orderRow = await observe(
      span,
      { name: 'shopify.query', spanType: 'tool', input: { userId } },
      async () => shopify.getRecentOrder(userId),
    )

    // child span: summarizer LLM
    const summary = await observe(
      span,
      { name: 'summarize_order', spanType: 'llm' },
      async () => {
        const res = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Summarize the order in one sentence.' },
            { role: 'user', content: JSON.stringify(orderRow) },
          ],
        })
        return res.choices[0].message.content
      },
    )

    return summary
  }),

  observe(trace, { name: 'lookup_kb', spanType: 'custom' }, async (span) => {
    // child span: pinecone retrieval
    const docs = await observe(
      span,
      { name: 'pinecone.query', spanType: 'retrieval', input: { topK: 5 } },
      async () => pinecone.index('kb').query({ vector: await embed(message), topK: 5 }),
    )

    // child span: answerer LLM
    const answer = await observe(
      span,
      { name: 'answer_from_kb', spanType: 'llm' },
      async () => {
        const res = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Answer using the context.' },
            { role: 'user', content: \`Context: \${docs.matches.map(m => m.metadata?.text).join('\\n\\n')}\\n\\nQuestion: \${message}\` },
          ],
        })
        return res.choices[0].message.content
      },
    )

    return answer
  }),
])`}</CodeBlock>
      <p>
        Two important details:
      </p>
      <ul>
        <li>
          The second argument to <code>observe()</code> is the <em>parent</em>. Passing
          {' '}<code>trace</code> creates a top-level span; passing <code>span</code> inside
          a callback creates a child of that span. This is how the tree is built.
        </li>
        <li>
          Spanlens does not enforce a foreign key on <code>parent_span_id</code>. If
          one branch finishes before the other, the late branch&apos;s spans still attach
          correctly when they eventually close. You do not need to await branches in
          order.
        </li>
      </ul>

      <h2>Step 5. Compose the final response</h2>
      <CodeBlock language="ts">{`const final = await observe(
  trace,
  { name: 'compose_final', spanType: 'llm' },
  async () => {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Write a friendly reply combining the order info and the answer.' },
        { role: 'user', content: \`Order info: \${orderInfo}\\n\\nAnswer: \${kbAnswer}\` },
      ],
    })
    return res.choices[0].message.content
  },
)

return final`}</CodeBlock>

      <h2>Step 6. What you see in /traces</h2>
      <CodeBlock language="text">{`Trace: support-agent  (3.2s, $0.0061, 5 LLM calls + 1 tool + 1 retrieval)
├── classify_intent          (450ms, $0.0008)
├── lookup_order  (parallel) (1.1s,  $0.0011)
│   ├── shopify.query        (840ms)
│   └── summarize_order      (240ms, $0.0005)
├── lookup_kb     (parallel) (2.7s,  $0.0035)   ← critical path
│   ├── pinecone.query       (300ms, 5 docs)
│   └── answer_from_kb       (2.3s,  $0.0023)
└── compose_final            (640ms, $0.0007)`}</CodeBlock>
      <p>
        The <em>critical path</em> annotation tells you the wall-clock-blocking chain. Even
        though <code>lookup_order</code> took 1.1 s, it ran in parallel with the slower{' '}
        <code>lookup_kb</code> branch, so trimming order lookup buys you nothing.
        Optimizing <code>answer_from_kb</code> would.
      </p>

      <h2>Common variations</h2>

      <h3>Conditional branches</h3>
      <p>
        If the intent is <code>general_question</code>, you might skip the order lookup
        entirely. Just wrap the conditional in plain TypeScript:
      </p>
      <CodeBlock language="ts">{`const branches = intent === 'order_status'
  ? [orderBranch(), kbBranch()]
  : [kbBranch()]

const results = await Promise.all(branches)`}</CodeBlock>
      <p>
        Skipped branches simply have no spans. The trace is whatever you actually
        executed.
      </p>

      <h3>Tagging the trace with user / session for cross-trace analysis</h3>
      <CodeBlock language="ts">{`const trace = client.startTrace({
  name: 'support-agent',
  metadata: {
    user_id: userId,
    session_id: sessionId,
    intent,        // populated after classification, set via trace.update(...) if you prefer post-hoc
  },
})`}</CodeBlock>

      <h3>Streaming the final response</h3>
      <p>
        Replace <code>chat.completions.create</code> with <code>stream: true</code>. The
        proxy buffers and logs the full response on stream end; the span closes when the
        stream finishes. First byte still arrives in ~200 ms.
      </p>

      <h2>What you skipped that you might want later</h2>
      <ul>
        <li>
          <strong>Per-step evals.</strong> Score the <code>answer_from_kb</code> step on
          helpfulness. See <a href="/docs/tutorials/nightly-evals">Nightly evals tutorial</a>.
        </li>
        <li>
          <strong>LangGraph version.</strong> If your agent grows past 5+ nodes, LangGraph
          + the callback handler is less ceremony than threading <code>observe()</code>{' '}
          everywhere. <a href="/docs/integrations/langgraph">LangGraph integration</a>{' '}
          covers it.
        </li>
        <li>
          <strong>Error surfaces.</strong> <code>observe()</code> catches throws and sets{' '}
          <code>span.status=&apos;error&apos;</code> automatically; failed traces show in red on
          the <a href="/traces">/traces</a> list.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next tutorial: <a href="/docs/tutorials/nightly-evals">scheduled evals on production prompts</a>.
      </p>
    </div>
  )
}
