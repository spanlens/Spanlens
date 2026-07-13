import { CodeBlock } from '../../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  title: 'Vercel AI SDK integration · Spanlens Docs',
  description:
    'Trace generateText, streamText, generateObject, and streamObject calls with Spanlens. Spread two callbacks into the AI SDK options and every LLM call, multi-step tool run, and structured output is recorded automatically.',
  alternates: { canonical: '/docs/integrations/vercel-ai' },
}

export default function VercelAiIntegration() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Vercel AI SDK integration</h1>
      <p className="lead">
        Vercel AI SDK exposes <code>onStepFinish</code> and <code>onFinish</code>{' '}
        callbacks on every call shape (<code>generateText</code>,{' '}
        <code>streamText</code>, <code>generateObject</code>,{' '}
        <code>streamObject</code>).{' '}
        <code>createSpanlensTracker</code> returns those two callbacks ready to
        spread directly into the AI SDK options, so a 2-line change records the
        span, token usage, model name, and multi-step tool topology to{' '}
        <a href="/traces">/traces</a> without touching the rest of the call.
        Works with AI SDK 4.x and 5.x via a duck-typed payload check, no peer
        dependency on the <code>ai</code> package.
      </p>

      <h2>Install</h2>
      <CodeBlock language="bash">{`pnpm add @spanlens/sdk
# the integration is exposed as a sub-path import — no extra peer dep`}</CodeBlock>

      <h2>Minimal setup</h2>
      <CodeBlock language="ts">{`import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensTracker } from '@spanlens/sdk/vercel-ai'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const tracker = createSpanlensTracker({ client, modelName: 'gpt-4o' })

const result = await generateText({
  model: openai('gpt-4o'),
  messages: [{ role: 'user', content: 'Summarise the latest release notes.' }],
  onStepFinish: tracker.onStepFinish,  // optional — captures intermediate tool steps
  onFinish:     tracker.onFinish,       // required — closes the span with token totals
})`}</CodeBlock>
      <p>
        A fresh trace is opened the moment{' '}
        <code>createSpanlensTracker</code> is called, so latency is measured
        from the user&apos;s perspective (not just from when the model started
        emitting). The span closes when <code>onFinish</code> fires.
      </p>

      <h2>What gets captured</h2>
      <table>
        <thead>
          <tr>
            <th>AI SDK call</th>
            <th>Captured</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>generateText</code></td>
            <td>single span, prompt + completion tokens, model, latency, finish reason</td>
            <td>token usage read from <code>response.usage</code></td>
          </tr>
          <tr>
            <td><code>streamText</code></td>
            <td>same shape — <code>onFinish</code> fires after the stream closes with the totals</td>
            <td>partial tokens during the stream are not split into sub-spans (kept flat)</td>
          </tr>
          <tr>
            <td><code>generateObject</code> / <code>streamObject</code></td>
            <td>span output carries the structured object as text via{' '}
              <code>JSON.stringify(...)</code></td>
            <td>token usage is identical to the text-mode siblings</td>
          </tr>
          <tr>
            <td>Multi-step tool calls (<code>maxSteps</code> &gt; 1)</td>
            <td><code>steps</code> count in span metadata; one final span per call</td>
            <td>individual tool calls are not split out (keeps the trace tree small)</td>
          </tr>
        </tbody>
      </table>

      <h2>Trace tree shape</h2>
      <p>
        A two-step tool-using call (model picks a tool, runs it, then writes the
        final answer) produces one span by default — the multi-step structure
        is recorded as <code>metadata.steps</code> on the same span so the trace
        tree stays readable in the common case:
      </p>
      <CodeBlock language="text">{`Trace: ai.generate            (3.2s)
└── llm.gpt-4o                (3.2s, steps=2, gpt-4o, 480/220 tokens, $0.0034)`}</CodeBlock>
      <p>
        To break tool calls out into their own spans, pass a parent trace and
        wrap your tool execution in <code>trace.span(...)</code> explicitly —
        see <em>Attaching to a long-lived trace</em> below.
      </p>

      <h2>Attaching to a long-lived trace</h2>
      <p>
        By default the tracker opens a fresh trace on each AI call and closes
        it when <code>onFinish</code> fires. To group multiple{' '}
        <code>generateText</code> turns under a single trace (chat sessions,
        agent loops, RAG pipelines), pass an existing trace at construction —
        the tracker leaves its lifecycle entirely to the caller:
      </p>
      <CodeBlock language="ts">{`const trace = client.startTrace({
  name: 'chat-session',
  metadata: { user_id: user.id, session_id: sessionId },
})

for (const userMessage of conversation) {
  const tracker = createSpanlensTracker({ client, trace, modelName: 'gpt-4o' })

  await generateText({
    model: openai('gpt-4o'),
    messages: history.concat({ role: 'user', content: userMessage }),
    onFinish: tracker.onFinish,
  })
}

await trace.end({ status: 'completed' })`}</CodeBlock>
      <p>
        Each turn lands as a child <code>llm.gpt-4o</code> span under the parent
        trace, so the chat appears as a single waterfall on{' '}
        <a href="/traces">/traces</a>.
      </p>

      <h2>Pairing with the proxy for accurate cost</h2>
      <p>
        The tracker reads token totals from the AI SDK callback payload, which
        is reliable on non-streaming calls but occasionally drifts on the early
        AI SDK 5.x betas. For authoritative billing-grade cost numbers, route
        the underlying provider through the Spanlens proxy and the matching
        Request row will always carry the canonical figure:
      </p>
      <CodeBlock language="ts">{`import { createOpenAI } from '@ai-sdk/openai'

const openai = createOpenAI({
  apiKey: process.env.SPANLENS_API_KEY!,
  baseURL: 'https://api.spanlens.io/proxy/openai/v1',
})

const result = await generateText({
  model: openai('gpt-4o'),
  // ... onFinish: tracker.onFinish, etc.
})`}</CodeBlock>
      <p>
        With the proxy in place, every model call lands as a Request in{' '}
        <a href="/requests">/requests</a> with the authoritative cost, and the
        matching <code>llm.gpt-4o</code> span links to it via{' '}
        <code>request_id</code> automatically.
      </p>

      <h2>Linking spans to prompt versions</h2>
      <p>
        Use the proxy approach above and attach a default header so the call is
        tagged with a{' '}
        <a href="/docs/features/prompts">Spanlens Prompts</a> version. The
        matching Request row carries <code>prompt_version_id</code>, so the A/B
        view can compare versions on real traffic:
      </p>
      <CodeBlock language="ts">{`const openai = createOpenAI({
  apiKey: process.env.SPANLENS_API_KEY!,
  baseURL: 'https://api.spanlens.io/proxy/openai/v1',
  headers: { 'x-spanlens-prompt-version': 'chatbot-system@3' },
})`}</CodeBlock>

      <h2>Verifying the integration</h2>
      <ol>
        <li>Make one <code>generateText</code> call with the tracker wired up.</li>
        <li>
          Open <a href="/traces">/traces</a>. A new trace appears with name{' '}
          <code>ai.generate</code> (or your custom <code>traceName</code>).
        </li>
        <li>
          Click into the trace. One <code>llm.&lt;modelName&gt;</code> span sits
          underneath with token counts and computed cost on the right panel.
        </li>
        <li>
          If you wired the proxy as well, the span links to the matching
          Request in <a href="/requests">/requests</a> via{' '}
          <code>request_id</code>. Open it to see the raw request and response
          bodies.
        </li>
      </ol>

      <h2>Troubleshooting</h2>

      <h3>Span shows zero tokens</h3>
      <p>
        AI SDK 4.x reports <code>promptTokens</code> /{' '}
        <code>completionTokens</code>; AI SDK 5.x renamed the fields to{' '}
        <code>inputTokens</code> / <code>outputTokens</code>. The tracker
        accepts both shapes via a fallback chain, so a zero count usually means
        the underlying provider didn&apos;t emit usage at all (some streaming
        responses on the AI SDK 5.x betas, certain Bedrock backends). Routing
        through the Spanlens proxy (see above) recovers the authoritative
        number from the raw stream.
      </p>

      <h3>Trace closes before tool calls finish</h3>
      <p>
        The auto-managed trace closes when <code>onFinish</code> fires, which
        is at the end of the AI SDK call — not the end of your application
        logic. If you kick off background work (DB writes, downstream API
        calls) after the LLM returns, pass an external trace via{' '}
        <code>trace=</code> and call <code>trace.end()</code> yourself when
        all work is done. See <em>Attaching to a long-lived trace</em>.
      </p>

      <h3>Multi-step trace looks flat</h3>
      <p>
        By design, the tracker keeps multi-step tool calls collapsed into one
        span with a <code>steps</code> count in metadata — most users want a
        readable trace, not a fan-out of tool noise. To break each tool call
        into its own span, drop the tracker for that portion and use{' '}
        <code>trace.span({'{'}name: &apos;tool.search&apos;, spanType: &apos;tool&apos;{'}'})</code>{' '}
        inside your tool implementation.
      </p>

      <h3>TypeScript complains about callback signatures</h3>
      <p>
        The tracker is duck-typed against the AI SDK 4.x and 5.x payloads, so
        the parameter types are intentionally loose (<code>any</code>-equivalent
        on the framework side). If your TS config rejects implicit unknowns,
        cast the callbacks explicitly:{' '}
        <code>
          onFinish: tracker.onFinish as Parameters&lt;typeof generateText&gt;[0][&apos;onFinish&apos;]
        </code>
        .
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/integrations/langgraph">LangGraph integration</a>{' '}
        for multi-agent workflows, or{' '}
        <a href="/docs/concepts/data-model">data model</a> for what ends up in
        ClickHouse.
      </p>
    </div>
  )
}
