import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Instructor integration · Spanlens Docs',
  description:
    'Trace Instructor structured-output calls with Spanlens. Captures the Pydantic schema, retry count, and per-retry token cost.',
  alternates: { canonical: '/docs/integrations/instructor' },
}

export default function InstructorIntegration() {
  return (
    <div>
      <h1>Instructor integration</h1>
      <p className="lead">
        Instructor wraps OpenAI / Anthropic clients to enforce structured output
        against a Pydantic schema. It retries the LLM call when validation fails.
        Spanlens captures the underlying LLM HTTP calls plus the retry count and
        the validation error per retry, so you can see when one bad prompt is
        triggering three expensive retries.
      </p>

      <h2>Install (Python)</h2>
      <CodeBlock language="bash">{`pip install spanlens instructor openai`}</CodeBlock>

      <h2>Minimal setup</h2>
      <CodeBlock language="python">{`from spanlens.integrations.openai import create_openai
import instructor
from pydantic import BaseModel

# Spanlens-instrumented OpenAI client
openai_client = create_openai()

# Wrap it with Instructor
client = instructor.from_openai(openai_client)

class UserInfo(BaseModel):
    name: str
    age: int

result = client.chat.completions.create(
    model="gpt-4o-mini",
    response_model=UserInfo,
    messages=[{"role": "user", "content": "Alex is 30."}],
)`}</CodeBlock>
      <p>
        Each underlying LLM call (including retries) lands in Spanlens as a
        separate request. They share the same trace ID so you can see all attempts
        for one logical operation in one trace view.
      </p>

      <h2>What gets captured</h2>
      <ul>
        <li>
          One <code>request</code> per attempt (initial call + every retry).
        </li>
        <li>
          The response schema name (e.g. <code>UserInfo</code>) as a tag on the
          trace.
        </li>
        <li>
          The validation error message on retries, captured in the request
          metadata.
        </li>
        <li>
          Total trace cost = sum of all retry costs. Spanlens surfaces this as
          one number in the trace view so retry waste is visible.
        </li>
      </ul>

      <h2>Detecting expensive retry loops</h2>
      <p>
        Sort the trace list by <code>retry_count desc</code> to find prompts that
        are routinely retrying. A high-retry prompt is usually a schema mismatch
        (the schema is too strict for the model output style) or an underspecified
        prompt. Both are fixable in the prompt or schema without touching
        Instructor.
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
