import { CodeBlock } from '../_components/code-block'

export const metadata = {
  title: '@spanlens/sdk · Spanlens Docs',
  description: 'TypeScript SDK reference — createOpenAI, createAnthropic, createGemini, observe, span helpers, and trace API.',
}

export default function SdkReference() {
  return (
    <div>
      <h1>@spanlens/sdk</h1>
      <p className="lead">
        Thin wrappers around the official OpenAI / Anthropic / Gemini SDKs that route traffic through
        Spanlens and add agent tracing primitives. Zero lock-in — response types and method signatures
        match the upstream SDKs 1:1.
      </p>

      <div className="my-6 rounded-lg border-l-4 border-accent bg-accent-bg p-4 text-sm">
        <p className="m-0 font-semibold text-accent">⚡ Use streaming for long requests</p>
        <p className="mt-1 mb-0 text-accent">
          The Spanlens proxy enforces a <strong>25-second first-byte timeout</strong>. For requests likely
          to exceed that (large <code>max_tokens</code>, slower models, big JSON outputs), set{' '}
          <code>stream: true</code> — first byte arrives in ~200ms and total duration is unbounded. If you
          still want a single JSON object, accumulate chunks server-side with the &ldquo;internal
          streaming&rdquo; pattern: stream from OpenAI inside <code>observe()</code>, concatenate{' '}
          <code>delta.content</code>, then return the merged string from your route handler. See the{' '}
          <a href="#observe">observe()</a> example below.
        </p>
      </div>

      <h2>Install</h2>
      <CodeBlock language="bash">{`npm install @spanlens/sdk
# or
pnpm add @spanlens/sdk`}</CodeBlock>

      <p>
        Peer dependencies are installed on demand. <code>createOpenAI()</code> requires <code>openai</code>,{' '}
        <code>createAnthropic()</code> requires <code>@anthropic-ai/sdk</code>, and <code>createGemini()</code>{' '}
        requires <code>@google/generative-ai</code>. Install only the ones you actually use.
      </p>

      <h2 id="create-openai">createOpenAI()</h2>
      <CodeBlock language="ts">{`import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI({
  apiKey: process.env.SPANLENS_API_KEY,   // optional — defaults to env
  project: 'my-app',                      // optional — project scope
})

const res = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hi' }],
})`}</CodeBlock>

      <p>
        Returns an <code>OpenAI</code> instance (the real one from the <code>openai</code> package) with{' '}
        <code>baseURL</code> pointing at <code>spanlens-server.vercel.app/proxy/openai/v1</code> and{' '}
        <code>apiKey</code> set to your Spanlens key. The actual provider key is looked up server-side
        from your registered keys in <code>/settings</code>.
      </p>

      <h3>Options</h3>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Type</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>apiKey</code></td>
            <td><code>string</code></td>
            <td><code>process.env.SPANLENS_API_KEY</code></td>
            <td>Your Spanlens API key (not your OpenAI key)</td>
          </tr>
          <tr>
            <td><code>project</code></td>
            <td><code>string</code></td>
            <td>—</td>
            <td>Project slug for tagging requests</td>
          </tr>
          <tr>
            <td><code>baseURL</code></td>
            <td><code>string</code></td>
            <td>Spanlens cloud</td>
            <td>Override for self-hosting</td>
          </tr>
        </tbody>
      </table>

      <h2 id="create-anthropic">createAnthropic()</h2>
      <CodeBlock language="ts">{`import { createAnthropic } from '@spanlens/sdk/anthropic'

const anthropic = createAnthropic()

const msg = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hi' }],
})`}</CodeBlock>

      <h2 id="create-gemini">createGemini()</h2>
      <CodeBlock language="ts">{`import { createGemini } from '@spanlens/sdk/gemini'

const genAI = createGemini()
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

const result = await model.generateContent('Hi')`}</CodeBlock>

      <h2 id="with-prompt-version">withPromptVersion() — tag requests with a prompt version</h2>
      <p>
        Link a logged request to a specific <a href="/docs/features/prompts">Prompts</a> version
        so it appears in the A/B comparison table. Pass the helper as the second argument to any
        OpenAI or Anthropic call:
      </p>
      <CodeBlock language="ts">{`import { createOpenAI, withPromptVersion } from '@spanlens/sdk/openai'

const openai = createOpenAI()

const res = await openai.chat.completions.create(
  {
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemPromptV3 }, { role: 'user', content: userMsg }],
  },
  withPromptVersion('chatbot-system@3'),
)`}</CodeBlock>
      <p>Accepted formats:</p>
      <ul>
        <li><code>{'<name>@<version>'}</code> — e.g. <code>chatbot-system@3</code></li>
        <li><code>{'<name>@latest'}</code> — auto-resolves server-side on every call</li>
        <li>Raw <code>prompt_versions.id</code> UUID</li>
      </ul>
      <p>
        Same helper exists on <code>@spanlens/sdk/anthropic</code>. For Gemini and non-Node
        languages, set the header directly: <code>x-spanlens-prompt-version: &lt;id&gt;</code>.
      </p>

      <h2 id="observe">observe() — agent tracing</h2>
      <p>
        Wrap any async function to turn it into a span in an agent trace. Nested <code>observe()</code>{' '}
        calls automatically become child spans.
      </p>
      <CodeBlock language="ts">{`import { observe } from '@spanlens/sdk'

const answer = await observe('answer-question', async () => {
  const docs = await observe('retrieve', async () => {
    return await vectorDb.search(query)
  })

  const response = await observe('generate', async () => {
    return await openai.chat.completions.create({ /* ... */ })
  })

  return response.choices[0].message.content
}, { trace: 'user-session-abc123' })`}</CodeBlock>

      <p>
        Each <code>observe()</code> call creates a row in the <code>spans</code> table with timing,
        inputs/outputs (if provided), and a link to the parent. Inspect traces in{' '}
        <a href="/traces">/traces</a>.
      </p>

      <h3>Options</h3>
      <CodeBlock language="ts">{`observe(name, fn, {
  trace?: string          // trace id — reuse across calls to group them
  input?: unknown         // serialized into span.input
  metadata?: object       // free-form tags
})`}</CodeBlock>

      <h2 id="observe-openai">observeOpenAI()</h2>
      <p>
        Shorthand to wrap a single OpenAI call as a span without manually calling <code>observe()</code>.
        Pass <code>promptVersion</code> in options to tag the request with a prompt version in one
        shot (equivalent to <code>withPromptVersion()</code>).
      </p>
      <CodeBlock language="ts">{`import { observeOpenAI } from '@spanlens/sdk/openai'

const res = await observeOpenAI(openai, {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hi' }],
}, {
  name: 'greeting',
  trace: 'session-1',
  promptVersion: 'greeter@latest',   // optional
})`}</CodeBlock>
      <p>
        Same <code>promptVersion</code> option is available on <code>observeAnthropic()</code>{' '}
        and <code>observeGemini()</code>.
      </p>

      <h2 id="span-handle">Low-level: SpanHandle / TraceHandle</h2>
      <p>
        For complex flows (parallel spans, manual timing), use the handle-based API.
      </p>
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

      <h2>TypeScript support</h2>
      <p>
        Fully typed. Re-exports the upstream SDK types so autocomplete, inference, and error types
        work exactly as they do with the official SDKs.
      </p>

      <hr />

      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/proxy">direct proxy</a> for non-Node languages, or{' '}
        <a href="/docs/self-host">self-hosting</a>.
      </p>
    </div>
  )
}
