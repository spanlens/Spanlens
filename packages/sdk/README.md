# @spanlens/sdk

LLM observability SDK for [Spanlens](https://spanlens.io). Record agent traces, LLM calls, tool invocations, and retrievals — with a single line change.

**Zero-instrumentation mode** — just swap your `baseURL` to Spanlens proxy and you get request logging + cost tracking automatically. Use this SDK when you also want **agent tracing** (multi-step workflows, parallel fan-out, nested spans).

> 💡 **Next.js user?** Run **[`npx @spanlens/cli init`](https://www.npmjs.com/package/@spanlens/cli)** — the wizard installs this SDK, writes your env var, and auto-rewrites `new OpenAI({...})` into `createOpenAI()` for you (30 seconds).

## Install

```bash
npm install @spanlens/sdk
# or
pnpm add @spanlens/sdk
```

## 1-line setup (v0.2.0+) ⚡

For the common case — **just route your LLM calls through Spanlens** for logging + cost tracking — use the pre-configured client helpers. No `baseURL` to remember:

```ts
// Before
import OpenAI from 'openai'
const openai = new OpenAI({
  apiKey: process.env.SPANLENS_API_KEY,
  baseURL: 'https://spanlens-server.vercel.app/proxy/openai/v1',
})

// After ⚡
import { createOpenAI } from '@spanlens/sdk/openai'
const openai = createOpenAI()  // reads SPANLENS_API_KEY + baseURL automatically
```

All three providers supported:

```ts
import { createOpenAI } from '@spanlens/sdk/openai'
import { createAnthropic } from '@spanlens/sdk/anthropic'
import { createGemini } from '@spanlens/sdk/gemini'

const openai    = createOpenAI()
const anthropic = createAnthropic()
const gemini    = createGemini()
// gemini.getGenerativeModel() auto-routes through Spanlens proxy
```

The returned clients are **identical** to `new OpenAI(...)` etc — all options (timeout, headers, organization, etc.) forward through. Peer dependencies (`openai`, `@anthropic-ai/sdk`, `@google/generative-ai`) are optional — install only the ones you use.

### Prompt A/B tagging (v0.2.2+)

Link a call to a specific [Spanlens Prompts](https://www.spanlens.io/docs/features/prompts) version so it shows up in the A/B metrics table:

```ts
import { createOpenAI, withPromptVersion } from '@spanlens/sdk/openai'
const openai = createOpenAI()

const res = await openai.chat.completions.create(
  { model: 'gpt-4o-mini', messages: [...] },
  withPromptVersion('chatbot-system@3'),   // or '@latest' / raw UUID
)
```

Same helper on `@spanlens/sdk/anthropic`. For `observeOpenAI/Anthropic/Gemini`, pass `promptVersion` in options.

For **multi-step agent tracing** (Gantt view, parent/child spans, RAG pipelines), continue to the Quick start below.

## Quick start

```ts
import { SpanlensClient, observe } from '@spanlens/sdk'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })

const trace = client.startTrace({
  name: 'support_chat',
  metadata: { user_id: 'u_42', session_id: 'sess_abc' },
})

try {
  // Manual span
  const retrievalSpan = trace.span({ name: 'kb_search', spanType: 'retrieval' })
  const docs = await vectorStore.query('...')
  await retrievalSpan.end({ output: { doc_count: docs.length } })

  // Auto-end via observe helper — handles errors, always closes the span
  const answer = await observe(trace, { name: 'gpt4o_answer', spanType: 'llm' }, async (span) => {
    const res = await openai.chat.completions.create({ ... })
    span.end({
      totalTokens: res.usage!.total_tokens,
      costUsd: computeCost(res.usage!),
    })
    return res.choices[0].message.content
  })

  await trace.end({ status: 'completed' })
} catch (err) {
  await trace.end({ status: 'error', errorMessage: String(err) })
  throw err
}
```

## API

### `new SpanlensClient(config)`

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | — | **required** Spanlens API key (`sl_live_...`). |
| `baseUrl` | `string` | `https://spanlens-server.vercel.app` | API base URL. |
| `timeoutMs` | `number` | `3000` | Request timeout for ingest calls. |
| `silent` | `boolean` | `true` | Swallow network errors so instrumentation never crashes user code. |
| `onError` | `(err, ctx) => void` | — | Called on every ingest failure (even when `silent`). |

### `client.startTrace({ name, metadata? })` → `TraceHandle`

Starts a new trace. Returns immediately — the backend ingest POST runs in the background.

### `TraceHandle`

- `.traceId: string` — client-generated UUID.
- `.span(options) → SpanHandle` — create a root span under this trace.
- `.end({ status?, errorMessage?, metadata? })` — mark trace complete (idempotent).

### `SpanHandle`

- `.spanId: string`
- `.child(options) → SpanHandle` — nested span (auto-sets `parent_span_id`).
- `.end({ status?, output?, errorMessage?, promptTokens?, completionTokens?, totalTokens?, costUsd?, requestId?, metadata? })` — idempotent.

**`spanType`**: `'llm' | 'tool' | 'retrieval' | 'embedding' | 'custom'` (default `'custom'`).

### `observe(parent, options, fn)`

Wraps an async function in a span. Auto-ends the span on success or failure (rethrows the error).

```ts
const result = await observe(traceOrSpan, { name: 'work' }, async (span) => {
  // span is open here
  return doWork()
  // span automatically closes — .end() is idempotent so you can still
  // call span.end({ totalTokens, costUsd }) inside to capture metrics.
})
```

## Framework examples

### OpenAI (auto-instrumentation)

```ts
import OpenAI from 'openai'
import { SpanlensClient, observeOpenAI } from '@spanlens/sdk'

const spanlens = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })

// Route OpenAI calls through the Spanlens proxy. The SDK injects
// x-trace-id/x-span-id headers so the proxy's request log is linked
// back to your spans.
const openai = new OpenAI({
  apiKey: process.env.SPANLENS_API_KEY!,
  baseURL: 'https://spanlens-server.vercel.app/proxy/openai/v1',
})

const trace = spanlens.startTrace({ name: 'support_chat' })

const res = await observeOpenAI(trace, 'answer', (headers) =>
  openai.chat.completions.create(
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] },
    { headers },
  ),
)

await trace.end({ status: 'completed' })
```

### Anthropic

```ts
import Anthropic from '@anthropic-ai/sdk'
import { SpanlensClient, observeAnthropic } from '@spanlens/sdk'

const spanlens = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const anthropic = new Anthropic({
  apiKey: process.env.SPANLENS_API_KEY!,
  baseURL: 'https://spanlens-server.vercel.app/proxy/anthropic',
})

const trace = spanlens.startTrace({ name: 'agent_run' })
const res = await observeAnthropic(trace, 'reason', (headers) =>
  anthropic.messages.create(
    { model: 'claude-haiku-4-5', max_tokens: 1024, messages: [...] },
    { headers },
  ),
)
await trace.end()
```

### LangChain JS (v0.3.0+)

`@spanlens/sdk/langchain` ships a drop-in callback handler. Pass it to the
`callbacks` option of any LangChain chain, LLM, or `RunnableConfig` — no
proxy URL needed, no imports from `@langchain/core` required:

```ts
import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const handler = createSpanlensCallbackHandler({ client })

// Works with any chain, LLM, or tool
const result = await chain.invoke({ input: 'Hello' }, { callbacks: [handler] })
// → prompt/completion tokens, model name, latency automatically recorded
```

Attach to an existing trace to nest spans under your workflow:

```ts
const trace = client.startTrace({ name: 'my_workflow' })
const handler = createSpanlensCallbackHandler({ client, trace })

await chain.invoke({ input: '...' }, { callbacks: [handler] })
await someOtherStep()

await trace.end()
```

### Vercel AI SDK (v0.3.0+)

`@spanlens/sdk/vercel-ai` provides `createSpanlensTracker()` whose
`onStepFinish` and `onFinish` callbacks spread directly into `generateText`,
`streamText`, `generateObject`, and `streamObject` options:

```ts
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { SpanlensClient } from '@spanlens/sdk'
import { createSpanlensTracker } from '@spanlens/sdk/vercel-ai'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const tracker = createSpanlensTracker({ client, modelName: 'gpt-4o' })

const result = await generateText({
  model: openai('gpt-4o'),
  messages: [{ role: 'user', content: 'Hello!' }],
  onStepFinish: tracker.onStepFinish,  // optional — captures multi-step tool calls
  onFinish: tracker.onFinish,          // required  — records final usage
})
```

Attach to an existing trace:

```ts
const trace = client.startTrace({ name: 'ai_pipeline' })
const tracker = createSpanlensTracker({ client, trace, modelName: 'gpt-4o' })

await generateText({ ..., onFinish: tracker.onFinish })
await trace.end()
```

### LlamaIndex TS (v0.3.0+)

`@spanlens/sdk/llamaindex` hooks directly into LlamaIndex's
`Settings.callbackManager` — every LLM call is automatically traced:

```ts
import { Settings } from 'llamaindex'
import { SpanlensClient } from '@spanlens/sdk'
import { registerSpanlensCallbacks } from '@spanlens/sdk/llamaindex'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })

// Register once at app startup
const unregister = registerSpanlensCallbacks(Settings, { client })

// All subsequent LlamaIndex LLM calls are now traced automatically
const response = await queryEngine.query({ query: 'What is Spanlens?' })

// Clean up when done (e.g. in tests or on process exit)
unregister()
```

Attach to an existing trace for RAG pipelines:

```ts
const trace = client.startTrace({ name: 'rag_query' })
const unregister = registerSpanlensCallbacks(Settings, { client, trace })

await queryEngine.query({ query: '...' })

unregister()
await trace.end()
```

## Graceful shutdown — `client.flush()`

Background ingest writes are fire-and-forget. In short-lived processes (scripts, one-shot jobs, serverless cold starts) the process may exit before all POSTs complete. Call `flush()` before exit to drain them:

```ts
const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })

// ... your agent logic ...

await client.flush()   // resolves when all in-flight ingest calls have settled
process.exit(0)
```

`flush()` resolves even if some requests failed — it uses `Promise.allSettled` internally so a network error won't hang the process.

## Design notes

- **Fire-and-forget ingest**: `startTrace()` and `trace.span()` return synchronously. Network writes run in the background so your hot path never waits on observability.
- **Retry with back-off**: transient failures (network error, 429, 5xx) are retried up to 3 times with exponential back-off (200 ms → 400 ms → 800 ms). 4xx errors are not retried.
- **Client-side UUIDs**: idempotent retries are safe — same UUID twice is a no-op on the server.
- **No unhandled rejections**: background POST failures are silently swallowed; use the `onError` hook for visibility.
- **No auto-instrumentation yet**: OpenAI/Anthropic wrappers ship in v0.2 — for now, wrap LLM calls manually inside `observe()` (or wrap via the proxy baseURL + manual span for tracing metadata).

## License

MIT
