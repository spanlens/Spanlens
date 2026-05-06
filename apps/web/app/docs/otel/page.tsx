import { CodeBlock } from '../_components/code-block'

export const metadata = {
  title: 'OpenTelemetry · Spanlens Docs',
  description:
    'Send traces to Spanlens via OTLP/HTTP using any OpenTelemetry SDK. Works with Python, Go, Java, and any gen_ai-instrumented framework.',
}

export default function OtelDocs() {
  return (
    <div>
      <h1>OpenTelemetry (OTLP)</h1>
      <p className="lead">
        Spanlens accepts traces from any OpenTelemetry SDK that emits{' '}
        <strong>OTLP/HTTP JSON</strong> using the{' '}
        <a
          href="https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/"
          target="_blank"
          rel="noopener noreferrer"
        >
          gen_ai semantic conventions
        </a>
        . No code rewrite required — configure your existing OTel exporter and spans flow
        directly into the waterfall dashboard.
      </p>

      <h2>Endpoint</h2>
      <CodeBlock language="text">{`POST https://server.spanlens.io/v1/traces
Content-Type: application/json
Authorization: Bearer sl_live_<your-key>`}</CodeBlock>
      <p>
        The path follows the OTLP spec exactly:{' '}
        <code>POST /v1/traces</code>. Only JSON encoding is supported (Protobuf is not).
      </p>

      <h2>Authentication</h2>
      <p>
        Use your Spanlens project API key (<code>sl_live_…</code>) as a Bearer token.
        Most OTel SDKs let you inject custom headers into the exporter:
      </p>
      <CodeBlock language="python">{`# Python — opentelemetry-exporter-otlp-proto-http
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

exporter = OTLPSpanExporter(
    endpoint="https://server.spanlens.io",
    headers={"Authorization": "Bearer sl_live_YOUR_KEY"},
)
`}</CodeBlock>

      <h2>Required attributes</h2>
      <p>
        Spanlens maps spans using the{' '}
        <a
          href="https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenTelemetry GenAI Semantic Conventions
        </a>
        . At minimum, attach these attributes to get useful data in the dashboard:
      </p>

      <table>
        <thead>
          <tr>
            <th>Attribute</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>gen_ai.operation.name</code></td>
            <td>string</td>
            <td>
              <code>chat</code>, <code>text_completion</code>,{' '}
              <code>execute_tool</code>, <code>embeddings</code>,{' '}
              <code>retrieval</code>, or <code>generate_content</code>
            </td>
          </tr>
          <tr>
            <td><code>gen_ai.provider.name</code></td>
            <td>string</td>
            <td><code>openai</code>, <code>anthropic</code>, <code>gemini</code>, …</td>
          </tr>
          <tr>
            <td><code>gen_ai.request.model</code></td>
            <td>string</td>
            <td>Model name used for the request (e.g. <code>gpt-4o</code>)</td>
          </tr>
          <tr>
            <td><code>gen_ai.usage.input_tokens</code></td>
            <td>int</td>
            <td>Prompt / input token count</td>
          </tr>
          <tr>
            <td><code>gen_ai.usage.output_tokens</code></td>
            <td>int</td>
            <td>Completion / output token count</td>
          </tr>
          <tr>
            <td><code>gen_ai.input.messages</code></td>
            <td>string</td>
            <td>Serialised input message array (optional, shown in span detail)</td>
          </tr>
          <tr>
            <td><code>gen_ai.output.messages</code></td>
            <td>string</td>
            <td>Serialised output / response (optional)</td>
          </tr>
        </tbody>
      </table>

      <h2>Span type mapping</h2>
      <p>
        Spanlens infers the span type from <code>gen_ai.operation.name</code>:
      </p>
      <table>
        <thead>
          <tr>
            <th>gen_ai.operation.name</th>
            <th>Spanlens span_type</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>chat</code>, <code>text_completion</code>, <code>generate_content</code></td><td><code>llm</code></td></tr>
          <tr><td><code>execute_tool</code></td><td><code>tool</code></td></tr>
          <tr><td><code>embeddings</code></td><td><code>embedding</code></td></tr>
          <tr><td><code>retrieval</code></td><td><code>retrieval</code></td></tr>
          <tr><td>(anything else)</td><td><code>custom</code></td></tr>
        </tbody>
      </table>

      <h2>Quick start — Python (opentelemetry-sdk)</h2>
      <CodeBlock language="python">{`from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

# Configure the OTLP exporter
exporter = OTLPSpanExporter(
    endpoint="https://server.spanlens.io",
    headers={"Authorization": "Bearer sl_live_YOUR_KEY"},
)

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(exporter))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("my-agent")

# Create a trace
with tracer.start_as_current_span("answer-question") as span:
    span.set_attribute("gen_ai.operation.name", "chat")
    span.set_attribute("gen_ai.provider.name", "openai")
    span.set_attribute("gen_ai.request.model", "gpt-4o")
    span.set_attribute("gen_ai.usage.input_tokens", 120)
    span.set_attribute("gen_ai.usage.output_tokens", 80)
    span.set_attribute("gen_ai.input.messages", '[{"role":"user","content":"Hello"}]')
    # ... call your LLM here
`}</CodeBlock>

      <h2>Quick start — Python with openai-agents SDK</h2>
      <p>
        The{' '}
        <a
          href="https://openai.github.io/openai-agents-python/"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenAI Agents SDK
        </a>{' '}
        emits gen_ai spans automatically. Point it at Spanlens:
      </p>
      <CodeBlock language="python">{`from agents.tracing import set_trace_processor
from agents.tracing.otlp import OTLPTraceProcessor

set_trace_processor(
    OTLPTraceProcessor(
        endpoint="https://server.spanlens.io/v1/traces",
        headers={"Authorization": "Bearer sl_live_YOUR_KEY"},
    )
)
`}</CodeBlock>

      <h2>Quick start — Node.js</h2>
      <CodeBlock language="ts">{`import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'https://server.spanlens.io/v1/traces',
    headers: { Authorization: 'Bearer sl_live_YOUR_KEY' },
  }),
})

sdk.start()
`}</CodeBlock>

      <h2>Response codes</h2>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Body</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>200</td>
            <td><code>{'{}'}</code></td>
            <td>All spans accepted</td>
          </tr>
          <tr>
            <td>200</td>
            <td><code>{`{"partialSuccess":{"rejectedSpans":N}}`}</code></td>
            <td>Some spans could not be persisted (N is the count)</td>
          </tr>
          <tr>
            <td>400</td>
            <td><code>{`{"error":"..."}`}</code></td>
            <td>Invalid JSON body</td>
          </tr>
          <tr>
            <td>401</td>
            <td><code>{`{"error":"Invalid API key"}`}</code></td>
            <td>Missing or invalid <code>sl_live_*</code> key</td>
          </tr>
          <tr>
            <td>415</td>
            <td><code>{`{"error":"..."}`}</code></td>
            <td>Protobuf encoding not supported — use <code>application/json</code></td>
          </tr>
        </tbody>
      </table>

      <h2>Notes</h2>
      <ul>
        <li>
          <strong>Trace IDs are external.</strong> OTel trace IDs (32-char hex) are stored separately
          from Spanlens&apos; internal UUIDs. Duplicate exports of the same OTel trace are idempotent —
          the trace row is upserted on <code>(organization_id, external_trace_id)</code>.
        </li>
        <li>
          <strong>Parent-child linking.</strong> Span parent relationships are resolved after
          each batch import via an internal SQL function that maps{' '}
          <code>external_parent_span_id → parent_span_id</code> (UUID). The Gantt waterfall
          shows the full tree.
        </li>
        <li>
          <strong>Cost calculation.</strong> If <code>gen_ai.provider.name</code> and{' '}
          <code>gen_ai.request.model</code> match a known entry in Spanlens&apos; model price
          table, cost is calculated automatically — no extra configuration required.
        </li>
        <li>
          <strong>Protobuf not supported.</strong> Configure your OTel SDK to use HTTP/JSON
          encoding (<code>application/json</code>). In Python this is{' '}
          <code>opentelemetry-exporter-otlp-proto-http</code> with{' '}
          <code>OTEL_EXPORTER_OTLP_PROTOCOL=http/json</code>.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/traces">Traces overview</a>,{' '}
        <a href="/docs/sdk">@spanlens/sdk</a> (native JS/TS SDK),{' '}
        <a href="/traces">/traces</a> dashboard.
      </p>
    </div>
  )
}
