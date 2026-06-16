import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'LangChain integration · Spanlens Docs',
  description:
    'Trace LangChain (JS and Python) chains, agents, and tools with one callback handler. Every chain run, LLM call, and tool invocation becomes a Spanlens span.',
  alternates: { canonical: '/docs/integrations/langchain' },
}

export default function LangChainIntegration() {
  return (
    <div>
      <h1>LangChain integration</h1>
      <p className="lead">
        LangChain (JS and Python) exposes a callback contract that fires for every
        chain start, LLM call, tool invocation, and agent step. The Spanlens
        callback handler attaches to that contract once and captures the full
        execution tree without modifying your chains.
      </p>

      <h2>Install (TypeScript)</h2>
      <CodeBlock language="bash">{`pnpm add @spanlens/sdk
# plus your existing langchain install:
pnpm add @langchain/core @langchain/openai`}</CodeBlock>

      <h2>Minimal setup (TypeScript)</h2>
      <CodeBlock language="ts">{`import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'
import { ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate } from '@langchain/core/prompts'

const client = new SpanlensClient()
const handler = createSpanlensCallbackHandler({ client })

const model = new ChatOpenAI({ model: 'gpt-4o-mini' })
const prompt = ChatPromptTemplate.fromMessages([
  ['system', 'You are a helpful assistant.'],
  ['user', '{question}'],
])

const chain = prompt.pipe(model)

// Attach at invocation time:
const result = await chain.invoke(
  { question: 'What is LLM observability?' },
  { callbacks: [handler] },
)`}</CodeBlock>

      <h2>Install (Python)</h2>
      <CodeBlock language="bash">{`pip install spanlens langchain langchain-openai`}</CodeBlock>

      <h2>Minimal setup (Python)</h2>
      <CodeBlock language="python">{`from spanlens import SpanlensClient
from spanlens.langchain import SpanlensCallbackHandler
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

client = SpanlensClient()
handler = SpanlensCallbackHandler(client=client)

model = ChatOpenAI(model="gpt-4o-mini")
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful assistant."),
    ("user", "{question}"),
])

chain = prompt | model

result = chain.invoke(
    {"question": "What is LLM observability?"},
    config={"callbacks": [handler]},
)`}</CodeBlock>

      <h2>What gets captured</h2>
      <table>
        <thead>
          <tr>
            <th>LangChain event</th>
            <th>Spanlens span</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>on_chain_start</code> / <code>on_chain_end</code>
            </td>
            <td>kind=&quot;agent_step&quot;</td>
            <td>Chain input/output captured as span attributes.</td>
          </tr>
          <tr>
            <td>
              <code>on_llm_start</code> / <code>on_llm_end</code>
            </td>
            <td>kind=&quot;llm&quot;</td>
            <td>Model, tokens, cost, response body. Streaming captured.</td>
          </tr>
          <tr>
            <td>
              <code>on_tool_start</code> / <code>on_tool_end</code>
            </td>
            <td>kind=&quot;tool&quot;</td>
            <td>Tool name, arguments, return value.</td>
          </tr>
          <tr>
            <td>
              <code>on_agent_action</code> / <code>on_agent_finish</code>
            </td>
            <td>kind=&quot;agent_step&quot;</td>
            <td>Agent reasoning step with the tool the agent picked.</td>
          </tr>
          <tr>
            <td>
              <code>on_chain_error</code> / <code>on_llm_error</code>
            </td>
            <td>span with status=&quot;error&quot;</td>
            <td>Error message and stack captured for debugging.</td>
          </tr>
        </tbody>
      </table>

      <h2>Agents with tools</h2>
      <p>
        For LangChain agents, the same handler captures the full reasoning loop:
        agent action, tool call, tool result, next agent action. The trace renders
        as a waterfall span tree with the critical path highlighted.
      </p>
      <CodeBlock language="ts">{`import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents'
import { DynamicTool } from '@langchain/core/tools'

const tools = [
  new DynamicTool({
    name: 'search',
    description: 'Search the knowledge base.',
    func: async (input) => '...',
  }),
]

const agent = await createOpenAIFunctionsAgent({ llm: model, tools, prompt })
const executor = new AgentExecutor({ agent, tools })

await executor.invoke(
  { input: 'Find me the latest pricing.' },
  { callbacks: [handler] },
)`}</CodeBlock>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <a href="/docs/integrations/langgraph">LangGraph</a>, native graph
          integration with critical-path highlighting.
        </li>
        <li>
          <a href="/docs/concepts/agent-tracing">Agent tracing concepts</a>, span
          tree structure.
        </li>
        <li>
          <a href="/docs/tutorials/agent-tracing">Agent tracing tutorial</a>,
          end-to-end RAG example.
        </li>
      </ul>
    </div>
  )
}
