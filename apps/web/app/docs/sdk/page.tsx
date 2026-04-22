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

      <h2>Install</h2>
      <pre><code>{`npm install @spanlens/sdk
# or
pnpm add @spanlens/sdk`}</code></pre>

      <p>
        Peer dependencies are installed on demand. <code>createOpenAI()</code> requires <code>openai</code>,{' '}
        <code>createAnthropic()</code> requires <code>@anthropic-ai/sdk</code>, and <code>createGemini()</code>{' '}
        requires <code>@google/generative-ai</code>. Install only the ones you actually use.
      </p>

      <h2 id="create-openai">createOpenAI()</h2>
      <pre><code>{`import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI({
  apiKey: process.env.SPANLENS_API_KEY,   // optional — defaults to env
  project: 'my-app',                      // optional — project scope
})

const res = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hi' }],
})`}</code></pre>

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
      <pre><code>{`import { createAnthropic } from '@spanlens/sdk/anthropic'

const anthropic = createAnthropic()

const msg = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hi' }],
})`}</code></pre>

      <h2 id="create-gemini">createGemini()</h2>
      <pre><code>{`import { createGemini } from '@spanlens/sdk/gemini'

const genAI = createGemini()
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

const result = await model.generateContent('Hi')`}</code></pre>

      <h2 id="observe">observe() — agent tracing</h2>
      <p>
        Wrap any async function to turn it into a span in an agent trace. Nested <code>observe()</code>{' '}
        calls automatically become child spans.
      </p>
      <pre><code>{`import { observe } from '@spanlens/sdk'

const answer = await observe('answer-question', async () => {
  const docs = await observe('retrieve', async () => {
    return await vectorDb.search(query)
  })

  const response = await observe('generate', async () => {
    return await openai.chat.completions.create({ /* ... */ })
  })

  return response.choices[0].message.content
}, { trace: 'user-session-abc123' })`}</code></pre>

      <p>
        Each <code>observe()</code> call creates a row in the <code>spans</code> table with timing,
        inputs/outputs (if provided), and a link to the parent. Inspect traces in{' '}
        <a href="/traces">/traces</a>.
      </p>

      <h3>Options</h3>
      <pre><code>{`observe(name, fn, {
  trace?: string          // trace id — reuse across calls to group them
  input?: unknown         // serialized into span.input
  metadata?: object       // free-form tags
})`}</code></pre>

      <h2 id="observe-openai">observeOpenAI()</h2>
      <p>
        Shorthand to wrap a single OpenAI call as a span without manually calling <code>observe()</code>.
      </p>
      <pre><code>{`import { observeOpenAI } from '@spanlens/sdk/openai'

const res = await observeOpenAI(openai, {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hi' }],
}, { name: 'greeting', trace: 'session-1' })`}</code></pre>

      <h2 id="span-handle">Low-level: SpanHandle / TraceHandle</h2>
      <p>
        For complex flows (parallel spans, manual timing), use the handle-based API.
      </p>
      <pre><code>{`import { SpanlensClient } from '@spanlens/sdk'

const client = new SpanlensClient()
const trace = client.startTrace('multi-agent-workflow')

const spanA = trace.startSpan('agent-a')
const spanB = trace.startSpan('agent-b')

const [resA, resB] = await Promise.all([
  runAgentA().then((r) => { spanA.end({ output: r }); return r }),
  runAgentB().then((r) => { spanB.end({ output: r }); return r }),
])

await trace.end()`}</code></pre>

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
