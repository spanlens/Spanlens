import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Flowise integration · Spanlens Docs',
  description:
    'Connect Flowise visual flows to Spanlens. Flowise calls go through the Spanlens proxy and each node executions becomes a span.',
  alternates: { canonical: '/docs/integrations/flowise' },
}

export default function FlowiseIntegration() {
  return (
    <div>
      <h1>Flowise integration</h1>
      <p className="lead">
        Flowise is a visual LangChain builder. Spanlens captures Flowise flows two
        ways: by routing LLM calls through the Spanlens proxy, which works for any
        node that calls OpenAI / Anthropic / Gemini, or by attaching the Spanlens
        LangChain callback handler in a custom node for full span-tree capture.
      </p>

      <h2>Option A: Proxy mode (zero code)</h2>
      <p>
        In Flowise, open the LLM credential settings for any chat model node and
        change the base URL to the Spanlens proxy endpoint for that provider.
      </p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Base URL</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>OpenAI / Azure OpenAI</td>
            <td>
              <code>https://api.spanlens.io/proxy/openai/v1</code>
            </td>
          </tr>
          <tr>
            <td>Anthropic</td>
            <td>
              <code>https://api.spanlens.io/proxy/anthropic/v1</code>
            </td>
          </tr>
          <tr>
            <td>Google Gemini</td>
            <td>
              <code>https://api.spanlens.io/proxy/gemini/v1beta</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Use your Spanlens API key (<code>sl_live_*</code>) in place of the
        provider API key. Spanlens stores your provider key securely and signs
        the upstream call on your behalf. Every LLM node in the flow now lands in{' '}
        <a href="/requests">/requests</a> automatically.
      </p>

      <h2>Option B: Custom callback node (full span tree)</h2>
      <p>
        For full per-node span capture (including the visual flow topology),
        register a custom Flowise tool that attaches the Spanlens LangChain
        handler to the chain config.
      </p>
      <CodeBlock language="ts">{`// flowise-spanlens-tool.ts
import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'

const client = new SpanlensClient()
const handler = createSpanlensCallbackHandler({ client })

export const onExecuteFlow = async (flowConfig, runtimeContext) => {
  return {
    ...runtimeContext,
    callbacks: [...(runtimeContext.callbacks || []), handler],
  }
}`}</CodeBlock>

      <h2>What you see in Spanlens</h2>
      <p>
        Each Flowise flow execution becomes a trace. The flow ID is preserved as
        a tag. Each LLM node becomes a span with model + cost + latency. Tool
        nodes become tool spans. Conditional branches and parallel fan-outs are
        reconstructed from the parent_span_id chain.
      </p>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <a href="/docs/integrations/langchain">LangChain integration</a>, since
          Flowise builds on LangChain.
        </li>
        <li>
          <a href="/docs/proxy">Proxy reference</a>, full proxy URL list.
        </li>
      </ul>
    </div>
  )
}
