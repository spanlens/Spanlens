import { CodeBlock } from '../../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  title: 'OpenAI Assistants API integration · Spanlens Docs',
  description:
    'Trace OpenAI Assistants API threads, runs, and steps with Spanlens. Tool calls and code-interpreter steps render as a span tree per run.',
  alternates: { canonical: '/docs/integrations/openai-assistants' },
}

export default function OpenAIAssistantsIntegration() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>OpenAI Assistants API integration</h1>
      <p className="lead">
        The Assistants API encapsulates threads, runs, and steps. Spanlens captures
        the full hierarchy: each thread becomes a trace, each run becomes an
        agent_step span, and each step (message creation, tool call, code
        interpreter invocation) becomes a child span. Spans inherit the OpenAI{' '}
        <code>thread_id</code>, <code>run_id</code>, and <code>step_id</code> as
        tags so you can pivot or filter on any of them.
      </p>

      <h2>Setup</h2>
      <p>
        The Spanlens OpenAI drop-in instruments the underlying HTTP layer, so all
        Assistants API endpoints are captured automatically. No extra wiring per
        thread or per run.
      </p>
      <CodeBlock language="ts">{`import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI()

const assistant = await openai.beta.assistants.create({
  name: 'Support agent',
  model: 'gpt-4o-mini',
  tools: [{ type: 'code_interpreter' }],
})

const thread = await openai.beta.threads.create()
await openai.beta.threads.messages.create(thread.id, {
  role: 'user',
  content: 'Plot the last week of revenue from this CSV.',
})

const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
  assistant_id: assistant.id,
})`}</CodeBlock>

      <h2>What gets captured</h2>
      <table>
        <thead>
          <tr>
            <th>Assistants API resource</th>
            <th>Spanlens entity</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Thread</td>
            <td>trace</td>
            <td>thread_id is the trace_id; one thread, one trace.</td>
          </tr>
          <tr>
            <td>Run</td>
            <td>span (kind=&quot;agent_step&quot;)</td>
            <td>One run per span. Includes model, usage, status.</td>
          </tr>
          <tr>
            <td>Message creation step</td>
            <td>span (kind=&quot;llm&quot;)</td>
            <td>Full input/output captured.</td>
          </tr>
          <tr>
            <td>Tool call step (function)</td>
            <td>span (kind=&quot;tool&quot;)</td>
            <td>Tool name, arguments, output captured.</td>
          </tr>
          <tr>
            <td>Code interpreter step</td>
            <td>span (kind=&quot;tool&quot;) with subtype=&quot;code&quot;</td>
            <td>Generated code and stdout captured.</td>
          </tr>
          <tr>
            <td>File search / retrieval step</td>
            <td>span (kind=&quot;tool&quot;) with subtype=&quot;retrieval&quot;</td>
            <td>Vector store ID and result count captured.</td>
          </tr>
        </tbody>
      </table>

      <h2>Multi-run thread cost</h2>
      <p>
        For a long-lived thread that runs the assistant multiple times, Spanlens
        aggregates cost across runs at the thread level. The trace view shows the
        cumulative cost-per-user-message split, which is the unit most product
        teams want to bill on.
      </p>

      <h2>Streaming runs</h2>
      <p>
        Streaming runs work without extra setup. The drop-in handles the
        server-sent events stream and emits one span per message delta plus a
        final aggregating span for the full run.
      </p>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <a href="/integrations/openai">OpenAI integration overview</a>.
        </li>
        <li>
          <a href="/docs/concepts/agent-tracing">Agent tracing concepts</a>.
        </li>
      </ul>
    </div>
  )
}
