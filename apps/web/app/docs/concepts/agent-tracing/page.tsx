import { CodeBlock } from '../../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  title: 'Agent tracing · Spanlens Docs',
  description:
    'How Spanlens models agent traces: trace root, agent steps, LLM calls, tool calls, parent/child links, and critical path computation.',
  alternates: { canonical: '/docs/concepts/agent-tracing' },
}

export default function AgentTracingConcept() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Agent tracing</h1>
      <p className="lead">
        An agent is a workflow where a language model decides what to do next.
        Production agents combine LLM calls, tool calls, sub-agent invocations, and
        retries, often in parallel and on non-deterministic branches. Tracing
        captures this entire flow as a hierarchical span tree so you can debug,
        cost-attribute, and optimize at every step. The marketing-side hub lives at{' '}
        <a href="/agent-tracing">/agent-tracing</a>.
      </p>

      <h2>The four-layer span tree</h2>
      <p>
        Spanlens renders every trace as four nested layers. Each layer maps to a
        concrete entity in <a href="/docs/concepts/data-model">the data model</a>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Layer</th>
            <th>Span kind</th>
            <th>Entity</th>
            <th>What it captures</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1. Trace root</td>
            <td>
              <code>trace</code>
            </td>
            <td>
              <code>traces</code> table
            </td>
            <td>End-to-end latency, total cost, trace ID, user/session tags</td>
          </tr>
          <tr>
            <td>2. Agent step</td>
            <td>
              <code>span</code> (kind=&quot;agent_step&quot;)
            </td>
            <td>
              <code>spans</code> table
            </td>
            <td>Step name, input state, output state, latency</td>
          </tr>
          <tr>
            <td>3. LLM call</td>
            <td>
              <code>span</code> (kind=&quot;llm&quot;)
            </td>
            <td>
              <code>spans</code> + <code>requests</code>
            </td>
            <td>Model, tokens, cost, full request/response body</td>
          </tr>
          <tr>
            <td>4. Tool call</td>
            <td>
              <code>span</code> (kind=&quot;tool&quot;)
            </td>
            <td>
              <code>spans</code> table
            </td>
            <td>Tool name, arguments from the LLM, return value, latency</td>
          </tr>
        </tbody>
      </table>

      <h2>Parent/child links</h2>
      <p>
        Every span has a <code>parent_span_id</code> field that points to the
        immediate parent. Spanlens does <strong>not</strong> enforce a foreign-key
        constraint on this column, by design — parallel agent fan-out and out-of-order
        ingestion mean child spans sometimes arrive before their parent. The trace
        builder reconstructs the tree at query time by joining on{' '}
        <code>(trace_id, parent_span_id)</code>. Orphaned spans (parent never
        arrives) attach to the trace root with a visible &quot;orphan&quot; marker
        rather than disappearing.
      </p>

      <h2>Critical path</h2>
      <p>
        Critical path is the longest dependency chain through the trace — the path
        that determines total wall-clock time. For an agent that runs four steps in
        parallel and one sequentially after, the critical path is{' '}
        <code>max(parallel_4) + sequential_1</code>. Optimizing a non-critical-path
        span has zero effect on total latency. Spanlens computes critical path
        automatically and colors those spans differently in the trace view.
      </p>
      <p>
        The algorithm walks the span tree from the trace root, follows the slowest
        child at each branch (when children run in parallel), and adds sequential
        children directly. Span overlap is detected via{' '}
        <code>(start_ms, end_ms)</code> ranges.
      </p>

      <h2>Emitting spans manually</h2>
      <p>
        For frameworks Spanlens does not ship a native integration for, emit spans
        with the SDK.
      </p>
      <CodeBlock language="ts">{`import { SpanlensClient } from '@spanlens/sdk'

const client = new SpanlensClient()
const trace = await client.startTrace({ name: 'support_ticket_flow' })

const classifyStep = await trace.startSpan({ name: 'classify', kind: 'agent_step' })
const classifyLlm = await classifyStep.startSpan({ name: 'classify.llm', kind: 'llm' })
// ... call your LLM ...
await classifyLlm.end({ tokens: { in: 1240, out: 12 }, cost_usd: 0.0023 })
await classifyStep.end()

await trace.end()`}</CodeBlock>

      <h2>OpenTelemetry mapping</h2>
      <p>
        Spanlens accepts OTLP/HTTP at <code>/v1/traces</code>. OTel span attributes
        map to Spanlens fields by convention:
      </p>
      <table>
        <thead>
          <tr>
            <th>OTel attribute</th>
            <th>Spanlens field</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>gen_ai.system</code>
            </td>
            <td>
              <code>provider</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>gen_ai.request.model</code>
            </td>
            <td>
              <code>model</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>gen_ai.usage.input_tokens</code>
            </td>
            <td>
              <code>tokens.in</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>gen_ai.usage.output_tokens</code>
            </td>
            <td>
              <code>tokens.out</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>gen_ai.response.finish_reasons</code>
            </td>
            <td>
              <code>finish_reason</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <a href="/docs/integrations/langgraph">LangGraph integration</a>, native
          callback handler.
        </li>
        <li>
          <a href="/docs/integrations/langchain">LangChain integration</a>, same
          callback contract.
        </li>
        <li>
          <a href="/docs/integrations/crewai">CrewAI integration</a>, multi-agent
          framework support.
        </li>
        <li>
          <a href="/docs/tutorials/agent-tracing">Tutorial</a>, end-to-end RAG agent
          example.
        </li>
      </ul>
    </div>
  )
}
