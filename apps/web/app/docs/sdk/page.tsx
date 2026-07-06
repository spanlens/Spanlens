import { CodeBlock } from '../_components/code-block'
import { LangTabs } from '../_components/lang-tabs'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  alternates: { canonical: '/docs/sdk' },
  title: 'Spanlens SDK · Spanlens Docs',
  description:
    'Official SDK reference for TypeScript and Python, createOpenAI, createAnthropic, createGemini, observe(), and the trace / span API.',
}

export default function SdkReference() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Spanlens SDK</h1>
      <p className="lead">
        Thin wrappers around the official OpenAI / Anthropic / Gemini SDKs that route traffic through
        Spanlens and add agent tracing primitives. Zero lock-in, response types and method signatures
        match the upstream SDKs 1:1. Available for TypeScript and Python.
      </p>

      <div className="my-6 rounded-lg border-l-4 border-accent bg-accent-bg p-4 text-sm">
        <p className="m-0 font-semibold text-accent">Tip: use streaming for long responses</p>
        <p className="mt-1 mb-0 text-accent">
          For requests with large <code>max_tokens</code>, slower models, or big JSON outputs, enable
          streaming, first byte arrives in ~200ms and total duration is unbounded. If you still want a
          single object back, accumulate chunks server-side and return the merged result from your route
          handler. See the <a href="#observe-streaming">streaming example</a> below.
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
  apiKey: process.env.SPANLENS_API_KEY,   // optional, defaults to env
  project: 'my-app',                      // optional, project scope
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
      <table className="[&_th:nth-child(2)]:text-left [&_td:nth-child(2)]:text-left [&_td:nth-child(2)]:whitespace-nowrap">
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
  model: 'claude-haiku-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hi' }],
})`}
        py={`from spanlens.integrations.anthropic import create_anthropic

client = create_anthropic()

msg = client.messages.create(
    model="claude-haiku-4-5",
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
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

const result = await model.generateContent('Hi')`}
        py={`from spanlens.integrations.gemini import create_gemini

client = create_gemini()  # httpx.Client pointed at the Spanlens proxy
res = client.post(
    "/v1beta/models/gemini-2.5-flash:generateContent",
    json={"contents": [{"parts": [{"text": "Hi"}]}]},
)
print(res.json())

# Or, for the official google-generativeai package:
# from spanlens.integrations.gemini import configure_gemini
# configure_gemini()  # routes all genai calls through Spanlens`}
      />

      <h2 id="with-prompt-version">withPromptVersion(), tag a request with a prompt version</h2>
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
        <li><code>{'<name>@<version>'}</code>, e.g. <code>chatbot-system@3</code></li>
        <li><code>{'<name>@latest'}</code>, auto-resolves server-side on every call</li>
        <li>Raw <code>prompt_versions.id</code> UUID</li>
      </ul>
      <p>
        The same helper exists on the Anthropic integration. For Gemini and any non-SDK transport,
        set the header directly: <code>x-spanlens-prompt-version: &lt;id&gt;</code>.
      </p>

      <h2 id="with-user">withUser() / withSession(), end-user tracking (v0.2.7+)</h2>
      <p>
        Tag a call with an end-user ID and session ID. The values are stored in{' '}
        <code>requests.user_id</code> / <code>requests.session_id</code> and can be filtered on
        the <a href="/docs/features/requests">/requests</a> page via{' '}
        <code>?userId=</code> / <code>?sessionId=</code>.
      </p>
      <p>
        The same end-user ID is what{' '}
        <a href="/docs/proxy">per-end-user rate limits</a> bucket on. Set a per-end-user
        cap from the <a href="/projects">Projects</a> page and send{' '}
        <code>withUser(id)</code> on each call for it to apply.
      </p>
      <LangTabs
        ts={`import {
  createOpenAI,
  withUser,
  withSession,
  withPromptVersion,
} from '@spanlens/sdk/openai'

const openai = createOpenAI()

const res = await openai.chat.completions.create(
  { model: 'gpt-4o-mini', messages: [...] },
  {
    headers: {
      ...withUser(currentUser.id).headers,
      ...withSession(sessionId).headers,
      ...withPromptVersion('chatbot@3').headers,
    },
  },
)`}
        py={`# Python SDK support coming soon, pass headers directly in the meantime
import openai

client = openai.OpenAI(
    api_key=os.environ["SPANLENS_API_KEY"],
    base_url="https://server.spanlens.io/proxy/openai/v1",
    default_headers={
        "x-spanlens-user": current_user_id,
        "x-spanlens-session": session_id,
    },
)`}
      />
      <p>
        Each helper returns <code>{`{ headers: { ... } }`}</code>, so multiple helpers can be
        spread together. The Anthropic integration exports the same helpers.
      </p>
      <p>
        All three headers are stripped by the <code>STRIP_PREFIXES</code> (<code>x-spanlens-*</code>)
        policy before forwarding to upstream providers (OpenAI/Anthropic/Gemini), they are used
        only as Spanlens internal metadata.
      </p>

      <h2 id="with-log-body">withLogBody(), control body retention (v0.3.x+)</h2>
      <p>
        Opt out of storing request/response bodies in your dashboard while keeping token counts,
        cost, latency, and identifiers. Use when prompts may contain end-user PII you don&apos;t
        want sent to Spanlens.
      </p>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>request_body / response_body</th>
            <th>tokens / cost / latency / model</th>
            <th>user_id / session_id</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>&apos;full&apos;</code> (default)</td>
            <td>Stored, with API-key pattern masking</td>
            <td>Stored</td>
            <td>Stored</td>
          </tr>
          <tr>
            <td><code>&apos;meta&apos;</code></td>
            <td><em>Empty</em></td>
            <td>Stored</td>
            <td>Stored</td>
          </tr>
          <tr>
            <td><code>&apos;none&apos;</code></td>
            <td><em>Empty</em></td>
            <td>Stored</td>
            <td><em>null</em></td>
          </tr>
        </tbody>
      </table>
      <p>
        Even in <code>&apos;full&apos;</code> mode, the server auto-masks API key patterns
        (<code>sk-*</code>, <code>sk-proj-*</code>, <code>sk-ant-*</code>, <code>AIza*</code>,
        <code>sl_live_*</code>) in stored bodies. See{' '}
        <a href="/docs/features/security">Security</a> for the masking policy.
      </p>
      <LangTabs
        ts={`import { createOpenAI, withLogBody, withUser } from '@spanlens/sdk/openai'

const openai = createOpenAI()

// Single-call opt-out
const res = await openai.chat.completions.create(
  {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: somePromptThatMayContainPII }],
  },
  withLogBody('meta'),
)

// Combine with other helpers
const res2 = await openai.chat.completions.create(
  { model: 'gpt-4o-mini', messages: [...] },
  {
    headers: {
      ...withLogBody('meta').headers,
      ...withUser(currentUser.id).headers,
    },
  },
)`}
        py={`# Python helper coming soon, set the header directly
from openai import OpenAI

openai = OpenAI(
    api_key=os.environ['SPANLENS_API_KEY'],
    base_url='https://server.spanlens.io/proxy/openai/v1',
    default_headers={'x-spanlens-log-body': 'meta'},
)`}
      />
      <p>Raw curl:</p>
      <CodeBlock>{`curl https://server.spanlens.io/proxy/openai/v1/chat/completions \\
  -H "Authorization: Bearer $SPANLENS_API_KEY" \\
  -H "x-spanlens-log-body: meta" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "gpt-4o-mini", "messages": [...]}'`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        Note: <code>withUser</code> / <code>withSession</code> become no-ops when{' '}
        <code>logBody: &apos;none&apos;</code> is set, the server drops those columns alongside
        the bodies.
      </p>

      <h2 id="sample-rate">sampleRate, trace sampling (v0.3.x+)</h2>
      <p>
        Cap the volume of trace + span ingestion without changing your application code. The
        decision is made per-trace at <code>startTrace()</code> / <code>start_trace()</code> time
        and is sticky for every span beneath that trace, so each surviving trace stays internally
        coherent in the dashboard (no half-sampled trees).
      </p>
      <LangTabs
        ts={`import { SpanlensClient } from '@spanlens/sdk'

const client = new SpanlensClient({
  apiKey: process.env.SPANLENS_API_KEY!,
  sampleRate: 0.1,   // keep 10% of successful traces; 100% of error traces
})`}
        py={`from spanlens import SpanlensClient

client = SpanlensClient(
    api_key="sl_live_...",
    sample_rate=0.1,  # keep 10% of successful traces; 100% of error traces
)`}
      />

      <h3>Tail-based error bypass</h3>
      <p>
        Sampled-out traces buffer their span POSTs and PATCHes in memory. When the trace ends:
      </p>
      <ul>
        <li>
          <strong>status = &quot;error&quot;</strong> → the buffer is replayed against the real
          transport (preserving FIFO order) and then the trace-end PATCH is sent. The trace appears
          in the dashboard identically to a sampled-in error trace.
        </li>
        <li>
          <strong>status = &quot;completed&quot;</strong> → the buffer is dropped silently. Zero
          network traffic for that trace&apos;s ingest layer.
        </li>
      </ul>
      <p>
        This means you can run aggressive sampling (e.g. <code>0.01</code> = 1%) and still get every
        failure for debugging. The buffer is capped at 1,000 ops per trace to bound memory for
        long-running agents.
      </p>

      <h3>What it does and doesn&apos;t affect</h3>
      <table>
        <thead>
          <tr>
            <th>Subsystem</th>
            <th>Affected by sampleRate?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Trace + span ingestion (<code>/ingest/traces</code>, <code>/ingest/spans</code>)</td>
            <td><strong>Yes</strong>, this is the OTLP-equivalent agent-tracing layer</td>
          </tr>
          <tr>
            <td>Proxy request logs (<code>/proxy/*</code> → ClickHouse <code>requests</code>)</td>
            <td>
              <strong>No</strong>, every LLM call is still recorded for cost / quota / anomaly
              tracking. Billing does not depend on the SDK&apos;s sampling decision.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Validation throws at client construction for values outside <code>[0.0, 1.0]</code>, fail
        fast rather than silently dropping 100% of traces because a string was passed by accident.
      </p>

      <h2 id="observe">observe(), agent tracing</h2>
      <p>
        Wrap any function to turn it into a span in an agent trace. The callback&rsquo;s return value
        is automatically captured as the span&rsquo;s <strong>output</strong>, no extra code needed.
        Pass <code>input</code> in the span options to record the inputs too.
      </p>
      <LangTabs
        ts={`import { SpanlensClient, observe } from '@spanlens/sdk'

const client = new SpanlensClient()
const trace = client.startTrace('answer-question')

const docs = await observe(
  trace,
  { name: 'retrieve', spanType: 'retrieval', input: { query } },
  async () => vectorDb.search(query),   // return value → auto-saved as output
)

const response = await observe(
  trace,
  { name: 'generate', spanType: 'llm' },
  async () => openai.chat.completions.create({ /* ... */ }),
)

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
        input/output, and a link to the parent trace. Inspect traces in{' '}
        <a href="/traces">/traces</a>.
      </p>

      <h3 id="observe-streaming">Streaming inside observe()</h3>
      <p>
        With <code>{'stream: true'}</code> you control the chunk loop, so pass the final token counts
        to <code>span.end()</code> once the stream is exhausted. The accumulated text you{' '}
        <code>return</code> is auto-captured as output.
      </p>
      <div className="my-4 rounded-lg border-l-4 border-green-500 bg-green-50 dark:bg-green-950 p-4 text-sm">
        <p className="m-0 font-semibold text-green-700 dark:text-green-400">Proxy users: output is automatic</p>
        <p className="mt-1 mb-0 text-green-700 dark:text-green-400">
          If you route through the Spanlens proxy via <code>createOpenAI()</code>,{' '}
          <code>createAnthropic()</code>, or <code>createGemini()</code>, the proxy captures the
          completed response server-side and writes it to your span automatically, no extra code
          needed. The <code>return accumulated</code> pattern below is the fallback for direct
          (non-proxy) calls.
        </p>
      </div>
      <LangTabs
        ts={`const text = await observe(
  trace,
  {
    name: 'gpt-4o-mini · analysis',
    spanType: 'llm',
    input: messages,           // captured at span creation
  },
  async (span) => {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }, { headers: span.traceHeaders() })

    let accumulated = ''
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null

    for await (const chunk of stream) {
      accumulated += chunk.choices[0]?.delta?.content ?? ''
      if (chunk.usage) usage = chunk.usage
    }

    // Pass token counts manually — the SDK can't read streaming chunks
    if (usage) {
      await span.end({
        status: 'completed',
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      })
    }

    return accumulated   // ← auto-saved as output; no need to pass output: here
  },
)`}
        py={`# Python streaming, accumulate manually, return for auto-capture
async def streaming_span(trace):
    async with observe(trace, {"name": "gpt-4o-mini", "span_type": "llm"}) as span:
        stream = openai_client.chat.completions.create(
            model="gpt-4o-mini", messages=messages, stream=True
        )
        accumulated = ""
        usage = None
        for chunk in stream:
            accumulated += chunk.choices[0].delta.content or ""
            if chunk.usage:
                usage = chunk.usage
        if usage:
            span.end(
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
                total_tokens=usage.total_tokens,
            )
        return accumulated  # auto-saved as output`}
      />

      <h2 id="observe-openai">observeOpenAI(), span + auto-parsed usage</h2>
      <p>
        Shorthand that wraps a single LLM call as a span, injects the trace headers so the proxy
        log can be linked to the span, and auto-parses <code>usage</code> from the response. Pass{' '}
        <code>promptVersion</code> in one shot:
      </p>
      <LangTabs
        ts={`import { observeOpenAI } from '@spanlens/sdk'

// String form — just give it a span name
const res = await observeOpenAI(trace, 'greeting', (headers) =>
  openai.chat.completions.create(
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] },
    { headers, ...withPromptVersion('greeter@latest') },
  ),
)

// Options object — pass logBody to opt out of body storage per call
const res2 = await observeOpenAI(
  trace,
  { name: 'pii-heavy-call', logBody: 'meta', promptVersion: 'greeter@latest' },
  (headers) => openai.chat.completions.create({ ... }, { headers }),
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
        and <code>observeGemini()</code> / <code>observe_gemini()</code>. The{' '}
        <code>logBody</code> option on the options form maps 1:1 to the{' '}
        <a href="#with-log-body"><code>withLogBody()</code></a> helper.
      </p>

      <h2 id="observe-ollama">observeOllama(), self-hosted LLMs (v0.5.0+ / 0.4.0+)</h2>
      <p>
        Ollama runs on your own machine (or in your VPC) and exposes an OpenAI-compatible API at{' '}
        <code>http://localhost:11434/v1</code>. Because the Spanlens proxy is hosted, it can&rsquo;t
        reach your local Ollama, but the SDK can. Wrap your Ollama call with{' '}
        <code>observeOllama()</code> and only the trace metadata (model, tokens, latency) flows to
        Spanlens. Your prompts and responses never leave your machine via Spanlens.
      </p>
      <p>
        The dashboard tags the trace <code>provider: ollama</code> and leaves the cost column as
        &ldquo;Self-hosted&rdquo; (no per-token billing to compute). Usage tokens still come through
        because Ollama&rsquo;s response includes the same <code>usage</code> field OpenAI does.
      </p>
      <LangTabs
        ts={`import OpenAI from 'openai'
import { SpanlensClient, observeOllama } from '@spanlens/sdk'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })

// Point the OpenAI SDK at your local Ollama — apiKey is required by the
// SDK but ignored by Ollama itself when running locally.
const ollama = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',
})

const trace = client.startTrace({ name: 'local_chat' })
const res = await observeOllama(trace, 'chat', (headers) =>
  ollama.chat.completions.create(
    {
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'Hello' }],
    },
    { headers },
  ),
)
await trace.end()`}
        py={`from openai import OpenAI
from spanlens import SpanlensClient, observe_ollama

client = SpanlensClient(api_key=os.environ["SPANLENS_API_KEY"])

ollama = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="ollama",  # ignored by local Ollama; required by the SDK
)

with client.start_trace("local_chat") as trace:
    response = observe_ollama(trace, "chat", lambda headers:
        ollama.chat.completions.create(
            model="llama3.2",
            messages=[{"role": "user", "content": "Hello"}],
            extra_headers=headers,
        )
    )`}
      />
      <h3 id="other-openai-compatible">Other OpenAI-compatible runtimes (vLLM, LM Studio, Together, Groq, …)</h3>
      <p>
        For any other OpenAI-compatible endpoint, use <code>observeOpenAI</code> with the{' '}
        <code>provider</code> override so the dashboard labels it correctly:
      </p>
      <LangTabs
        ts={`await observeOpenAI(
  trace,
  { name: 'inference', provider: 'vllm' }, // or 'lm-studio', 'together', 'groq', …
  (headers) => vllmClient.chat.completions.create({ ... }, { headers }),
)`}
        py={`observe_openai(
    trace,
    "inference",
    lambda headers: vllm_client.chat.completions.create(...),
    provider="vllm",  # or "lm-studio", "together", "groq", ...
)`}
      />

      <h2 id="framework-integrations">Framework integrations</h2>
      <p>
        If you use LangChain, LangGraph (v0.6.0+ / 0.5.0+), Vercel AI SDK, or LlamaIndex, plug in
        the matching integration instead of wiring callbacks manually. Each one records spans
        automatically, tokens, latency, model name, and the full chain/tool/retriever topology ,
        without importing from the framework itself (duck-typed, version-agnostic).
      </p>

      <h3 id="langchain">LangChain & LangGraph (v0.6.0+ / 0.5.0+)</h3>
      <p>
        One callback handler works for plain LangChain chains, LCEL pipelines, and{' '}
        <strong>LangGraph compiled graphs</strong>. Spanlens captures LLM, chain, tool, and
        retriever spans automatically, and uses LangChain&rsquo;s built-in{' '}
        <code>runId</code> / <code>parentRunId</code> tracking to assemble the right span tree
        without any manual parent wiring.
      </p>
      <LangTabs
        ts={`import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const handler = createSpanlensCallbackHandler({ client })

// Plain LangChain — chain, LLM, agent, retriever — all work the same way:
await chain.invoke({ input: '...' }, { callbacks: [handler] })

// LangGraph — pass the same handler to the compiled graph:
const graph = workflow.compile()
const result = await graph.invoke(
  { input: 'plan a trip to Tokyo' },
  { callbacks: [handler] },
)`}
        py={`from spanlens import SpanlensClient
from spanlens.integrations.langchain import SpanlensCallbackHandler

client = SpanlensClient(api_key=os.environ["SPANLENS_API_KEY"])
handler = SpanlensCallbackHandler(client=client)

# Plain LangChain:
chain.invoke({"input": "..."}, config={"callbacks": [handler]})

# LangGraph, same handler:
graph = workflow.compile()
result = graph.invoke(
    {"input": "plan a trip to Tokyo"},
    config={"callbacks": [handler]},
)`}
      />

      <h4 id="langchain-span-tree">Resulting span tree</h4>
      <p>
        A 2-node LangGraph with one tool call produces this trace on the dashboard:
      </p>
      <CodeBlock>{`trace: langchain_run
└─ chain.LangGraph                       (the graph itself)
   ├─ chain.plan                         (node 1)
   │  └─ llm.ChatOpenAI                  (model + tokens captured)
   └─ chain.execute                      (node 2)
      ├─ tool.search                     (input + output captured)
      └─ llm.ChatOpenAI`}</CodeBlock>

      <h4 id="langchain-options">Options</h4>
      <p>All defaults preserve LangGraph&rsquo;s full structure. Turn things off to quiet down the dashboard:</p>
      <table>
        <thead>
          <tr><th>Option</th><th>Default</th><th>What it controls</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>captureChains</code> / <code>capture_chains</code></td>
            <td><code>true</code></td>
            <td>Chain spans (LangGraph nodes, LCEL steps, plain chains). Off = LLM/tool/retriever spans become direct children of the trace.</td>
          </tr>
          <tr>
            <td><code>captureTools</code> / <code>capture_tools</code></td>
            <td><code>true</code></td>
            <td>Tool call spans (each tool execution).</td>
          </tr>
          <tr>
            <td><code>captureRetrieval</code> / <code>capture_retrieval</code></td>
            <td><code>true</code></td>
            <td>Retriever spans (with documents summarised as output).</td>
          </tr>
          <tr>
            <td><code>maxInputBytes</code> / <code>max_input_bytes</code></td>
            <td><code>16_384</code></td>
            <td>JSON byte cap on <code>span.input</code>. Larger payloads become <code>{'{ __truncated: true, preview, originalBytes }'}</code>.</td>
          </tr>
          <tr>
            <td><code>maxOutputBytes</code> / <code>max_output_bytes</code></td>
            <td><code>16_384</code></td>
            <td>Same as above, for <code>span.output</code>.</td>
          </tr>
          <tr>
            <td><code>trace</code></td>
            <td>,</td>
            <td>Optional pre-existing trace to attach to. When given, the handler does <strong>not</strong> close the trace (caller owns the lifecycle).</td>
          </tr>
          <tr>
            <td><code>traceName</code> / <code>trace_name</code></td>
            <td><code>&quot;langchain_run&quot;</code></td>
            <td>Name for auto-created traces (one per top-level run).</td>
          </tr>
        </tbody>
      </table>

      <h4 id="langchain-notes">Notes</h4>
      <ul>
        <li>
          <strong>Single handler, multiple runs</strong>, concurrent invocations are tracked by
          LangChain&rsquo;s per-run UUID, so one handler instance is safe to share across
          parallel graph executions.
        </li>
        <li>
          <strong>Duck-typed</strong>, Spanlens does not import from{' '}
          <code>@langchain/core</code> or <code>langchain-core</code>. Major-version bumps in
          LangChain itself don&rsquo;t require an SDK update.
        </li>
        <li>
          <strong>Python optional dep</strong>, the handler falls back to a plain class when{' '}
          <code>langchain-core</code> isn&rsquo;t installed, so unit tests for your own code can
          drive it without LangChain being in the test environment.
        </li>
      </ul>

      <h3 id="vercel-ai">Vercel AI SDK</h3>
      <p>
        Pass <code>tracker.onStepFinish</code> and <code>tracker.onFinish</code> to{' '}
        <code>generateText</code> / <code>streamText</code>. Works with AI SDK 4.x and 5.x.
      </p>
      <LangTabs
        ts={`import { createSpanlensTracker } from '@spanlens/sdk/vercel-ai'
import { SpanlensClient } from '@spanlens/sdk'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const tracker = createSpanlensTracker({ client, modelName: 'gpt-4o' })

const result = await generateText({
  model: openai('gpt-4o'),
  messages: [{ role: 'user', content: 'Hello' }],
  onStepFinish: tracker.onStepFinish,  // records intermediate tool steps
  onFinish: tracker.onFinish,          // closes span with final token counts
  onError: tracker.onError,            // closes span if a streaming call fails
})`}
        py={`# Vercel AI SDK is TypeScript-only`}
      />

      <h3 id="llamaindex">LlamaIndex TS</h3>
      <p>
        Hook into <code>Settings.callbackManager</code> before running queries.
        Call the returned <code>unregister()</code> function to detach when done.
      </p>
      <LangTabs
        ts={`import { registerSpanlensCallbacks } from '@spanlens/sdk/llamaindex'
import { SpanlensClient } from '@spanlens/sdk'
import { Settings } from 'llamaindex'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const unregister = registerSpanlensCallbacks(Settings, { client })

// ... run your LlamaIndex queries ...
await queryEngine.query({ query: 'What is RAG?' })

unregister()  // remove callbacks when done (e.g. on process exit)`}
        py={`# LlamaIndex Python integration, coming soon`}
      />

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

      <h2 id="flush">Graceful shutdown, <code>client.flush()</code></h2>
      <p>
        Ingest calls run in the background. In short-lived processes, scripts, one-shot jobs,
        serverless cold starts, the process can exit before all POSTs complete. Call{' '}
        <code>flush()</code> before exit to drain them:
      </p>
      <CodeBlock language="ts">{`const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })

// ... your agent logic ...

await client.flush()   // resolves when all in-flight ingest calls have settled
process.exit(0)`}</CodeBlock>
      <p>
        <code>flush()</code> uses <code>Promise.allSettled</code> internally, it resolves even if
        some requests failed, so a network error won&apos;t hang the process. Failed writes are
        silently dropped (or forwarded to your <code>onError</code> hook if set). Transient
        failures are retried up to 3 times with exponential back-off (200 ms → 400 ms → 800 ms)
        before giving up.
      </p>

      <h2 id="non-blocking">Non-blocking by design</h2>
      <p>
        Both SDKs do the actual ingest HTTP calls in the background, the TypeScript SDK uses the
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

    </div>
  )
}
