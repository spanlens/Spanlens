import { CodeBlock } from '../_components/code-block'
import { LangTabs } from '../_components/lang-tabs'

export const metadata = {
  title: 'Spanlens SDK · Spanlens Docs',
  description:
    'Official SDK reference for TypeScript and Python — createOpenAI, createAnthropic, createGemini, observe(), and the trace / span API.',
}

export default function SdkReference() {
  return (
    <div>
      <h1>Spanlens SDK</h1>
      <p className="lead">
        Thin wrappers around the official OpenAI / Anthropic / Gemini SDKs that route traffic through
        Spanlens and add agent tracing primitives. Zero lock-in — response types and method signatures
        match the upstream SDKs 1:1. Available for TypeScript and Python.
      </p>

      <div className="my-6 rounded-lg border-l-4 border-accent bg-accent-bg p-4 text-sm">
        <p className="m-0 font-semibold text-accent">⚡ Use streaming for long requests</p>
        <p className="mt-1 mb-0 text-accent">
          The Spanlens proxy enforces a <strong>25-second first-byte timeout</strong>. For requests likely
          to exceed that (large <code>max_tokens</code>, slower models, big JSON outputs), enable streaming
          — first byte arrives in ~200ms and total duration is unbounded. If you still want a single JSON
          object, accumulate chunks server-side with the &ldquo;internal streaming&rdquo; pattern: stream
          inside <code>observe()</code>, concatenate <code>delta.content</code>, then return the merged
          string from your route handler. See the <a href="#observe">observe()</a> example below.
        </p>
      </div>

      <h2>Install</h2>
      <LangTabs
        ts={`npm install @spanlens/sdk
# or
pnpm add @spanlens/sdk`}
        py={`pip install spanlens

# Provider integrations are optional extras:
pip install "spanlens[openai]"
pip install "spanlens[anthropic]"
pip install "spanlens[gemini]"
pip install "spanlens[all]"`}
      />

      <p>
        Provider SDKs are installed on demand. For TypeScript, install <code>openai</code>,{' '}
        <code>@anthropic-ai/sdk</code>, or <code>@google/generative-ai</code> alongside Spanlens. For
        Python, use the matching extras shown above.
      </p>

      <h2 id="create-openai">createOpenAI() — proxy mode</h2>
      <p>
        Constructs the official provider client with <code>base_url</code> pointed at the Spanlens proxy
        and <code>api_key</code> set to your Spanlens key. Your real OpenAI key never leaves the
        Spanlens server.
      </p>
      <LangTabs
        ts={`import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI({
  apiKey: process.env.SPANLENS_API_KEY,   // optional — defaults to env
  project: 'my-app',                      // optional — project scope
})

const res = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hi' }],
})`}
        py={`from spanlens.integrations.openai import create_openai

# Reads SPANLENS_API_KEY from the environment
client = create_openai()

res = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hi"}],
)`}
      />

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
            <td><code>apiKey</code> / <code>api_key</code></td>
            <td><code>string</code></td>
            <td><code>SPANLENS_API_KEY</code> env var</td>
            <td>Your Spanlens API key (not your OpenAI key)</td>
          </tr>
          <tr>
            <td><code>baseURL</code> / <code>base_url</code></td>
            <td><code>string</code></td>
            <td>Spanlens cloud proxy</td>
            <td>Override for self-hosting</td>
          </tr>
        </tbody>
      </table>

      <h2 id="create-anthropic">createAnthropic()</h2>
      <LangTabs
        ts={`import { createAnthropic } from '@spanlens/sdk/anthropic'

const anthropic = createAnthropic()

const msg = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hi' }],
})`}
        py={`from spanlens.integrations.anthropic import create_anthropic

client = create_anthropic()

msg = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hi"}],
)`}
      />

      <h2 id="create-gemini">createGemini()</h2>
      <p>
        Gemini doesn&rsquo;t expose a per-instance <code>base_url</code> the way OpenAI/Anthropic do.
        On TypeScript we wrap <code>GoogleGenerativeAI</code> with a proxy. On Python the helper
        returns a pre-configured <code>httpx.Client</code> for raw REST calls; for the official Python
        SDK use <code>configure_gemini()</code> instead.
      </p>
      <LangTabs
        ts={`import { createGemini } from '@spanlens/sdk/gemini'

const genAI = createGemini()
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

const result = await model.generateContent('Hi')`}
        py={`from spanlens.integrations.gemini import create_gemini

client = create_gemini()  # httpx.Client pointed at the Spanlens proxy
res = client.post(
    "/v1beta/models/gemini-1.5-flash:generateContent",
    json={"contents": [{"parts": [{"text": "Hi"}]}]},
)
print(res.json())

# Or, for the official google-generativeai package:
# from spanlens.integrations.gemini import configure_gemini
# configure_gemini()  # routes all genai calls through Spanlens`}
      />

      <h2 id="with-prompt-version">withPromptVersion() — tag a request with a prompt version</h2>
      <p>
        Link a logged request to a specific <a href="/docs/features/prompts">Prompts</a> version so
        it appears in the A/B comparison table. Pass the helper as the second argument (TS) or
        unpack into kwargs (Python):
      </p>
      <LangTabs
        ts={`import { createOpenAI, withPromptVersion } from '@spanlens/sdk/openai'

const openai = createOpenAI()

const res = await openai.chat.completions.create(
  {
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemPromptV3 }, { role: 'user', content: userMsg }],
  },
  withPromptVersion('chatbot-system@3'),
)`}
        py={`from spanlens.integrations.openai import create_openai, with_prompt_version

client = create_openai()

res = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": system_prompt_v3},
        {"role": "user", "content": user_msg},
    ],
    **with_prompt_version("chatbot-system@3"),
)`}
      />
      <p>Accepted formats:</p>
      <ul>
        <li><code>{'<name>@<version>'}</code> — e.g. <code>chatbot-system@3</code></li>
        <li><code>{'<name>@latest'}</code> — auto-resolves server-side on every call</li>
        <li>Raw <code>prompt_versions.id</code> UUID</li>
      </ul>
      <p>
        The same helper exists on the Anthropic integration. For Gemini and any non-SDK transport,
        set the header directly: <code>x-spanlens-prompt-version: &lt;id&gt;</code>.
      </p>

      <h2 id="observe">observe() — agent tracing</h2>
      <p>
        Wrap any function to turn it into a span in an agent trace. Sync and async are both detected
        automatically.
      </p>
      <LangTabs
        ts={`import { SpanlensClient, observe } from '@spanlens/sdk'

const client = new SpanlensClient()
const trace = client.startTrace('answer-question')

const docs = await observe(trace, { name: 'retrieve', spanType: 'retrieval' }, async () => {
  return await vectorDb.search(query)
})

const response = await observe(trace, { name: 'generate', spanType: 'llm' }, async () => {
  return await openai.chat.completions.create({ /* ... */ })
})

await trace.end()`}
        py={`from spanlens import SpanlensClient, observe

client = SpanlensClient(api_key="sl_live_...")

with client.start_trace("answer-question") as trace:
    docs = observe(trace, "retrieve", lambda span: vector_db.search(query))

    response = observe(trace, "generate", lambda span:
        openai_client.chat.completions.create(...)
    )
    # trace.end() runs automatically when the with-block exits`}
      />

      <p>
        Each <code>observe()</code> call creates a row in the <code>spans</code> table with timing,
        inputs/outputs (if provided), and a link to the parent trace. Inspect traces in{' '}
        <a href="/traces">/traces</a>.
      </p>

      <h2 id="observe-openai">observeOpenAI() — span + auto-parsed usage</h2>
      <p>
        Shorthand that wraps a single LLM call as a span, injects the trace headers so the proxy
        log can be linked to the span, and auto-parses <code>usage</code> from the response. Pass{' '}
        <code>promptVersion</code> in one shot:
      </p>
      <LangTabs
        ts={`import { observeOpenAI } from '@spanlens/sdk'

const res = await observeOpenAI(trace, 'greeting', (headers) =>
  openai.chat.completions.create(
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] },
    { headers, ...withPromptVersion('greeter@latest') },
  ),
)`}
        py={`from spanlens import observe_openai

res = observe_openai(trace, "greeting", lambda headers:
    openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Hi"}],
        extra_headers={**headers, "x-spanlens-prompt-version": "greeter@latest"},
    )
)`}
      />
      <p>
        Same pattern works with <code>observeAnthropic()</code> / <code>observe_anthropic()</code>{' '}
        and <code>observeGemini()</code> / <code>observe_gemini()</code>.
      </p>

      <h2 id="span-handle">Low-level: trace + span handles</h2>
      <p>
        For complex flows (parallel spans, manual timing) use the handle-based API directly. Spans
        end automatically on context-exit in Python; in TypeScript call <code>span.end()</code>{' '}
        explicitly.
      </p>
      <LangTabs
        ts={`import { SpanlensClient } from '@spanlens/sdk'

const client = new SpanlensClient()
const trace = client.startTrace('multi-agent-workflow')

const spanA = trace.startSpan('agent-a')
const spanB = trace.startSpan('agent-b')

const [resA, resB] = await Promise.all([
  runAgentA().then((r) => { spanA.end({ output: r }); return r }),
  runAgentB().then((r) => { spanB.end({ output: r }); return r }),
])

await trace.end()`}
        py={`from spanlens import SpanlensClient

client = SpanlensClient(api_key="sl_live_...")

with client.start_trace("multi-agent-workflow") as trace:
    with trace.span("agent-a") as span_a:
        result_a = run_agent_a()
        span_a.end(output=result_a)

    with trace.span("agent-b") as span_b:
        result_b = run_agent_b()
        span_b.end(output=result_b)`}
      />

      <h2 id="non-blocking">Non-blocking by design</h2>
      <p>
        Both SDKs do the actual ingest HTTP calls in the background — the TypeScript SDK uses the
        runtime&rsquo;s native promise queue, while Python uses a small daemon thread pool. Either
        way, your hot path (the LLM call itself) is never delayed by Spanlens, and a slow / down
        Spanlens server never crashes your app. Failures are swallowed by default; pass{' '}
        <code>silent: false</code> (TS) or <code>silent=False</code> (Python) plus an{' '}
        <code>onError</code> hook to surface them.
      </p>

      <h2>TypeScript &amp; Python compatibility</h2>
      <ul>
        <li>TypeScript SDK: Node 18+, Deno, Bun, Vercel Edge / Cloudflare Workers</li>
        <li>Python SDK: 3.9, 3.10, 3.11, 3.12, 3.13</li>
      </ul>

      <hr />

      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/proxy">direct proxy</a> for languages without an SDK, or{' '}
        <a href="/docs/self-host">self-hosting</a>.
      </p>

      <h2 className="sr-only">Reference: original CodeBlock without tabs</h2>
      <p className="hidden">
        {/* Keeps CodeBlock import from being marked unused — it stays available
            for any future single-language snippet. */}
      </p>
      <CodeBlock language="bash">{`# Quick links
# • TypeScript:  https://www.npmjs.com/package/@spanlens/sdk
# • Python:      https://pypi.org/project/spanlens/`}</CodeBlock>
    </div>
  )
}
