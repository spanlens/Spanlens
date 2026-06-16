import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'AWS Bedrock integration · Spanlens Docs',
  description:
    'Capture AWS Bedrock model invocations (Claude, Llama, Mistral, Titan) with Spanlens. SigV4 auth handled by your SDK; Spanlens proxies the wire.',
  alternates: { canonical: '/docs/integrations/bedrock' },
}

export default function BedrockIntegration() {
  return (
    <div>
      <h1>AWS Bedrock integration</h1>
      <p className="lead">
        Bedrock hosts Anthropic Claude, Meta Llama, Mistral, Cohere Command, and
        Amazon Titan behind a single SigV4-authenticated endpoint per region.
        Spanlens captures Bedrock invocations through the AWS SDK, regardless of
        which model you call.
      </p>

      <h2>Two integration options</h2>
      <p>
        Pick based on whether you want to route through the Spanlens proxy or keep
        all calls inside your AWS network.
      </p>

      <h3>Option A: Drop-in SDK wrapper (any region, network egress to Spanlens)</h3>
      <CodeBlock language="ts">{`import { createBedrockRuntime } from '@spanlens/sdk/bedrock'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'

const inner = new BedrockRuntimeClient({ region: 'us-east-1' })
const bedrock = createBedrockRuntime(inner) // wraps with instrumentation

const cmd = new InvokeModelCommand({
  modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  body: JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'hi' }],
  }),
})

const response = await bedrock.send(cmd)`}</CodeBlock>
      <p>
        The wrapper captures the model ID, input/output token counts (parsed from
        the Bedrock response body), and cost. Spanlens looks up the Bedrock model
        ID against the price table to compute cost in USD.
      </p>

      <h3>Option B: In-network OTel exporter (no egress)</h3>
      <p>
        For regulated environments where requests must not leave your VPC, run
        Spanlens self-hosted inside the VPC and emit spans via the OTel exporter.
        Bedrock requests go to AWS directly; only span data flows to your local
        Spanlens.
      </p>
      <CodeBlock language="ts">{`import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'https://spanlens.internal/v1/traces',
    headers: { Authorization: 'Bearer sl_live_...' },
  }),
})
sdk.start()`}</CodeBlock>

      <h2>Cost calculation per model</h2>
      <p>
        Bedrock pricing varies per model ID and per region. Spanlens stores
        region-aware prices for the most common Bedrock model IDs. For new models
        not yet in the price table, calls are still logged but cost is null; add
        the price to the model price table (see{' '}
        <a href="/docs/features/cost-tracking">cost tracking</a>) or wait for the
        next Spanlens release.
      </p>

      <h2>What gets captured</h2>
      <ul>
        <li>Model ID (the dated ID, e.g. anthropic.claude-3-5-sonnet-20241022-v2:0)</li>
        <li>Region</li>
        <li>Input + output tokens</li>
        <li>Cost in USD (when the model ID is in the price table)</li>
        <li>Latency, status, error messages</li>
        <li>Full request/response body (subject to the log-body header)</li>
      </ul>

      <h2>What does not get captured</h2>
      <ul>
        <li>
          AWS credentials (never logged or stored — the AWS SDK signs requests
          locally).
        </li>
        <li>
          Streaming reasoning tokens for some Bedrock model variants — usage on
          streaming is provider-specific and not all Bedrock models emit it in
          their stream events.
        </li>
      </ul>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <a href="/integrations/anthropic">Anthropic integration overview</a>.
        </li>
        <li>
          <a href="/docs/concepts/llm-observability">LLM observability concepts</a>.
        </li>
      </ul>
    </div>
  )
}
