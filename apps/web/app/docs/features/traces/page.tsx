import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Traces · Spanlens Docs',
  description:
    'Agent tracing with nested span trees. See exactly where time goes when your LLM agent calls five tools in sequence.',
}

export default function TracesDocs() {
  return (
    <div>
      <h1>Traces</h1>
      <p className="lead">
        When your code makes one LLM call, a flat request log is enough. When it makes ten calls
        orchestrated across retrieval, generation, tool-use, and re-ranking, you need a tree.
        Spanlens Traces give you that tree — automatically when you wrap code in{' '}
        <code>observe()</code>, or manually with the low-level span API.
      </p>

      <h2>Why it matters</h2>
      <p>
        Agent workflows are hard to debug because the interesting failure is never in one call.
        It&apos;s in the interaction: retrieval returned garbage, so generation hallucinated, so the
        re-ranker picked a bad answer. Flat logs show three unrelated lines. A trace shows one tree
        with timings — immediately obvious where the bug lives.
      </p>
      <p>
        LangSmith and LangFuse popularized this view. Spanlens delivers the same thing without
        requiring you to migrate to LangChain or adopt heavyweight decorators.
      </p>

      <h2>How it works</h2>

      <h3>The data model</h3>
      <p>
        A <strong>trace</strong> groups related spans under one id. A <strong>span</strong> is any
        piece of async work — an LLM call, a vector DB search, a tool invocation, a custom
        function. Spans nest via <code>parent_span_id</code>, forming a tree.
      </p>
      <CodeBlock language="text">{`trace: "user-session-abc123"
└── answer-question              (1.8s)
    ├── retrieve                 (120ms)
    ├── generate                 (1.4s)   ← where the time went
    │   └── openai.chat.create   (1.4s, $0.0043, gpt-4o-mini)
    └── rerank                   (280ms)`}</CodeBlock>
      <p>
        Every span records: start/end time, input, output (optional), status, and metadata. LLM
        spans automatically capture tokens, cost, model, and provider.
      </p>

      <h3>Parallel spans are first-class</h3>
      <p>
        The database schema intentionally does NOT enforce a foreign key on <code>parent_span_id</code>.
        This lets you fire off parallel children, record them as they finish, and close the parent
        later — no ordering constraints. Essential for real agent code that runs{' '}
        <code>Promise.all([agentA(), agentB()])</code>.
      </p>

      <h2>Using it</h2>

      <h3>Option 1 — <code>observe()</code> (recommended)</h3>
      <p>
        Wrap any async function. Nested <code>observe()</code> calls automatically become child
        spans:
      </p>
      <CodeBlock language="ts">{`import { observe } from '@spanlens/sdk'

const answer = await observe('answer-question', async () => {
  const docs = await observe('retrieve', async () => {
    return vectorDb.search(query)
  })

  const response = await observe('generate', async () => {
    return openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: buildMessages(docs),
    })
  })

  return response.choices[0].message.content
}, { trace: 'user-session-abc123' })`}</CodeBlock>

      <h3>Option 2 — <code>observeOpenAI()</code> for single-call convenience</h3>
      <CodeBlock language="ts">{`import { observeOpenAI } from '@spanlens/sdk/openai'

const res = await observeOpenAI(openai, {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: question }],
}, { name: 'greeting', trace: 'session-1' })`}</CodeBlock>
      <p>
        Usage and cost are parsed automatically from the OpenAI response and attached to the span.
        Same thing exists for Anthropic (<code>observeAnthropic</code>) and Gemini (<code>observeGemini</code>).
      </p>

      <h3>Option 3 — Low-level handles (for parallel spans)</h3>
      <CodeBlock language="ts">{`import { SpanlensClient } from '@spanlens/sdk'

const client = new SpanlensClient()
const trace = client.startTrace('multi-agent-workflow')

const spanA = trace.startSpan('agent-a')
const spanB = trace.startSpan('agent-b')

const [resA, resB] = await Promise.all([
  runAgentA().then((r) => { spanA.end({ output: r }); return r }),
  runAgentB().then((r) => { spanB.end({ output: r }); return r }),
])

await trace.end()`}</CodeBlock>

      <h3>Option 4 — OpenTelemetry SDK (OTLP)</h3>
      <p>
        Already using an OTel SDK in Python, Go, Java, or another language? Point its OTLP exporter
        at Spanlens and spans flow in automatically — no code rewrite required. Spanlens reads the{' '}
        <a
          href="https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/"
          target="_blank"
          rel="noopener noreferrer"
        >
          gen_ai semantic conventions
        </a>{' '}
        and maps them to the same trace/span model as the JS SDK.
      </p>
      <p>
        See <a href="/docs/otel">OpenTelemetry (OTLP)</a> for the endpoint URL, required
        attributes, and quickstart examples.
      </p>

      <h3>Viewing traces in the dashboard</h3>

      <h4>Trace list</h4>
      <p>
        Open <a href="/traces">/traces</a>. The header strip shows aggregate stats for the current
        page: total trace count, p50/p95 duration (p95 turns orange when it exceeds 8 s), average
        spans per trace, and error count.
      </p>
      <ul>
        <li>
          <strong>Filters.</strong> Status (All / OK / Error / Live) and time range
          (1 h / 24 h / 7 d / 30 d / All time). The search box matches agent name or trace ID prefix.
          All active filters are mirrored to the URL so you can share or bookmark a filtered view.
        </li>
        <li>
          <strong>Sorting.</strong> Click the <em>Spans</em>, <em>Duration</em>, <em>Cost</em>, or{' '}
          <em>Age</em> column headers to sort. Click the same header again to reverse the direction.
        </li>
        <li>
          <strong>Export.</strong> The export button (top-right of the toolbar) downloads the current
          filtered result as CSV or JSON via <code>GET /api/v1/exports/traces</code>. Useful for
          dropping into a spreadsheet or a BI tool.
        </li>
        <li>
          <strong>Pagination.</strong> 50 traces per page. Previous / Next controls appear at the
          bottom when there is more than one page.
        </li>
      </ul>

      <h4>Trace detail</h4>
      <p>
        Click any row to open the detail view. The waterfall shows the full span tree with per-span
        latency bars. Use the span-type tabs (LLM / Tool / Retrieval / Embedding / Custom) or the
        <em>errors only</em> toggle to narrow the view, and the search box to filter by span name.
      </p>
      <ul>
        <li>
          <strong>Live indicator.</strong> While a trace is still running, the header shows{' '}
          <em>Live · refreshing every 3s</em> and the active span pulses. The page automatically
          re-fetches so you can watch an agent execute in real time.
        </li>
        <li>
          <strong>Critical path.</strong> Spans on the longest root-to-leaf chain are labelled{' '}
          <code>critical</code>. The summary card below the waterfall shows what percentage of
          wall-clock time the critical path represents and which spans it passes through (e.g.{' '}
          <code>answer-question → generate</code>). This is usually the first place to look when
          optimising latency.
        </li>
        <li>
          <strong>Longest span.</strong> A second card highlights the single slowest span so you
          can jump straight to it without scrolling through a deep tree.
        </li>
        <li>
          <strong>σ (sigma) annotation.</strong> When a trace contains three or more spans of the
          same type, Spanlens computes the mean and standard deviation for that type. Any span whose
          duration is ≥ 2σ above the mean receives a <code>2.3σ latency</code> label in the
          waterfall. This surfaces statistical outliers — a retrieval call that took five times longer
          than usual — without you having to compare numbers manually.
        </li>
        <li>
          <strong>Span drawer.</strong> Click any span bar to open the detail drawer. It has four
          tabs: <em>Input</em>, <em>Output</em>, <em>Metadata</em> (custom key-value attributes
          attached to the span), and <em>Raw</em> (the full JSON row as stored). LLM spans also show
          an <em>Open request →</em> link to the corresponding <a href="/requests">/requests</a> row.
        </li>
      </ul>

      <h2>Design choices worth knowing</h2>
      <ul>
        <li>
          <strong>Fire-and-forget ingest.</strong> <code>startTrace()</code> and{' '}
          <code>span()</code> return synchronously; network POSTs to Spanlens run in the background.
          Your request hot path is never blocked by span ingest — typical overhead is under 1ms per
          span call.
        </li>
        <li>
          <strong>Client-generated UUIDs.</strong> Idempotent — if your retry loop calls{' '}
          <code>span.end()</code> twice with the same UUID, the second call is a server-side
          no-op. No duplicated spans.
        </li>
        <li>
          <strong>Edge-compatible.</strong> Uses only <code>fetch</code> and{' '}
          <code>crypto.randomUUID()</code>. Works in Vercel Edge, Cloudflare Workers, Deno, Bun,
          and Node 18+.
        </li>
        <li>
          <strong>Errors don&apos;t break your request.</strong> Default{' '}
          <code>silent: true</code> swallows span-ingest failures. Provide an <code>onError</code>{' '}
          hook on <code>SpanlensClient</code> if you want visibility.
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>No zoom or pan yet.</strong> The waterfall fits the trace
          duration to the viewport width. For traces with thousands of spans
          you&apos;ll want to drill into a sub-tree — that lives on the
          roadmap.
        </li>
        <li>
          <strong>Inline label hides on narrow bars.</strong> Spans that take
          less than ~8% of total duration show only as a colored sliver;
          hover for the precise timing tooltip, or click to open the side
          panel.
        </li>
        <li>
          <strong>No OpenTelemetry export yet.</strong> Spanlens accepts OTLP{' '}
          <em>ingest</em> (OTel SDK → Spanlens), but the reverse direction — exporting
          Spanlens spans into Datadog, Honeycomb, or another APM — is not yet supported.
          Planned for a future release.
        </li>
        <li>
          <strong>Trace IDs are opaque strings.</strong> We don&apos;t yet enforce W3C traceparent
          format — so linking Spanlens traces to your app&apos;s APM traces requires you to pass the
          same id to both.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/requests">Requests</a> (flat log),{' '}
        <a href="/docs/sdk">@spanlens/sdk</a> (API reference),{' '}
        <a href="/docs/otel">OpenTelemetry (OTLP)</a> (Python / Go / Java),{' '}
        <a href="/traces">/traces</a> dashboard.
      </p>
    </div>
  )
}
