import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'CrewAI integration · Spanlens Docs',
  description:
    'Trace CrewAI crews, agents, and tasks with Spanlens. One install captures the full crew execution tree with per-agent cost and latency.',
  alternates: { canonical: '/docs/integrations/crewai' },
}

export default function CrewAIIntegration() {
  return (
    <div>
      <h1>CrewAI integration</h1>
      <p className="lead">
        CrewAI orchestrates multiple agents that each have their own role, goal,
        backstory, and tool set. Spanlens captures the full crew execution tree:
        one root span per crew kickoff, one child span per agent task, and one
        leaf span per LLM call or tool invocation. Per-agent cost and latency
        surface in the trace view so you can see which agent burned the budget.
      </p>

      <h2>Install</h2>
      <CodeBlock language="bash">{`pip install spanlens crewai crewai-tools`}</CodeBlock>

      <h2>Minimal setup</h2>
      <p>
        CrewAI internally uses LangChain for LLM calls. Attach the Spanlens
        LangChain callback handler to each agent&apos;s LLM, and the trace flows
        through the crew automatically.
      </p>
      <CodeBlock language="python">{`from crewai import Agent, Task, Crew
from langchain_openai import ChatOpenAI
from spanlens import SpanlensClient
from spanlens.langchain import SpanlensCallbackHandler

client = SpanlensClient()
handler = SpanlensCallbackHandler(client=client)

llm = ChatOpenAI(model="gpt-4o-mini", callbacks=[handler])

researcher = Agent(
    role="Researcher",
    goal="Find the latest on a topic.",
    backstory="You read primary sources first.",
    llm=llm,
)

writer = Agent(
    role="Writer",
    goal="Turn research into a short brief.",
    backstory="You write for technical readers.",
    llm=llm,
)

research_task = Task(description="Research LLM observability tools.", agent=researcher)
write_task = Task(description="Write a brief from the research.", agent=writer)

crew = Crew(agents=[researcher, writer], tasks=[research_task, write_task])
result = crew.kickoff()`}</CodeBlock>

      <h2>What gets captured</h2>
      <table>
        <thead>
          <tr>
            <th>CrewAI event</th>
            <th>Spanlens span</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Crew kickoff</td>
            <td>kind=&quot;trace&quot; (root)</td>
          </tr>
          <tr>
            <td>Task execution</td>
            <td>kind=&quot;agent_step&quot; with agent role as attribute</td>
          </tr>
          <tr>
            <td>LLM call inside a task</td>
            <td>kind=&quot;llm&quot;</td>
          </tr>
          <tr>
            <td>Tool call from an agent</td>
            <td>kind=&quot;tool&quot;</td>
          </tr>
          <tr>
            <td>Delegation between agents</td>
            <td>kind=&quot;agent_step&quot; with delegation_target attribute</td>
          </tr>
        </tbody>
      </table>

      <h2>Hierarchical vs sequential crews</h2>
      <p>
        Spanlens renders both crew modes correctly. Sequential crews produce a
        linear span chain; hierarchical crews produce a tree where the manager
        agent has child spans per delegated task. Critical path computation works
        the same way for both.
      </p>

      <h2>Per-agent cost attribution</h2>
      <p>
        Spans are tagged with the agent role, so the <a href="/users">/users</a>{' '}
        and savings views aggregate cost per agent. For a crew where one
        researcher agent calls gpt-4o while writers use gpt-4o-mini, you see the
        cost breakdown automatically.
      </p>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <a href="/docs/integrations/langchain">LangChain integration</a>, since
          CrewAI uses LangChain internally.
        </li>
        <li>
          <a href="/docs/concepts/agent-tracing">Agent tracing concepts</a>.
        </li>
      </ul>
    </div>
  )
}
