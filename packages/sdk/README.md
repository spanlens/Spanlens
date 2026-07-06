# @spanlens/sdk

LLM observability SDK for [Spanlens](https://spanlens.io). Record agent traces, LLM calls, tool invocations, and retrievals with a single line change.

**Zero-instrumentation mode**. Just swap your `baseURL` to Spanlens proxy and you get request logging + cost tracking automatically. Use this SDK when you also want **agent tracing** (multi-step workflows, parallel fan-out, nested spans).

> 💡 **Next.js user?** Run **[`npx @spanlens/cli init`](https://www.npmjs.com/package/@spanlens/cli)**. The wizard installs this SDK, writes your env var, and auto-rewrites `new OpenAI({...})` into `createOpenAI()` for you (30 seconds).

## Install

```bash
npm install @spanlens/sdk
# or
pnpm add @spanlens/sdk
```

## 1-line setup (v0.2.0+) ⚡

For the common case where you **just want to route your LLM calls through Spanlens** for logging + cost tracking, use the pre-configured client helpers. No `baseURL` to remember:

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

The returned clients are **identical** to `new OpenAI(...)` etc, so all options (timeout, headers, organization, etc.) forward through. Peer dependencies (`openai`, `@anthropic-ai/sdk`, `@google/generative-ai`) are optional. Install only the ones you use.

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

### Per-user, per-session, and body-redaction tagging

The same `headers`-style helpers cover the other `X-Spanlens-*` headers. Available on both `@spanlens/sdk/openai` and `@spanlens/sdk/anthropic`.

```ts
import { createOpenAI, withUser, withSession, withLogBody } from '@spanlens/sdk/openai'
const openai = createOpenAI()

await openai.chat.completions.create(
  { model: 'gpt-4o-mini', messages: [...] },
  {
    headers: {
      ...withUser(currentUser.id).headers,        // per-user analytics in /users
      ...withSession(sessionId).headers,          // group calls into one session
      ...withLogBody('meta').headers,             // 'full' | 'meta' | 'none' (body redaction level)
    },
  },
)
```

- **`withUser(id)`** tags the call so it shows up under that user in the [/users](https://www.spanlens.io/users) page (cost, tokens, error rate, last seen).
- **`withSession(id)`** groups calls in the same chat / conversation so multi-turn flows are easy to inspect.
- **`withLogBody('meta')`** stores only metadata, not request / response bodies. Use `'none'` to also drop end-user IDs. Useful for HIPAA-style data minimization without dropping the request entirely.

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

  // Auto-end via observe helper (handles errors, always closes the span)
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
| `apiKey` | `string` | (required) | Spanlens API key (`sl_live_...`). |
| `baseUrl` | `string` | `https://spanlens-server.vercel.app` | API base URL. |
| `timeoutMs` | `number` | `3000` | Request timeout for ingest calls. |
| `silent` | `boolean` | `true` | Swallow network errors so instrumentation never crashes user code. |
| `onError` | `(err, ctx) => void` | (none) | Called on every ingest failure (even when `silent`). |

### `client.startTrace({ name, metadata? })` → `TraceHandle`

Starts a new trace. Returns immediately. The backend ingest POST runs in the background.

### `TraceHandle`

- `.traceId: string`. A client-generated UUID.
- `.span(options) → SpanHandle` creates a root span under this trace.
- `.end({ status?, errorMessage?, metadata? })` marks the trace complete (idempotent).

### `SpanHandle`

- `.spanId: string`
- `.child(options) → SpanHandle` creates a nested span (auto-sets `parent_span_id`).
- `.end({ status?, output?, errorMessage?, promptTokens?, completionTokens?, totalTokens?, costUsd?, requestId?, metadata? })` is idempotent.

**`spanType`**: `'llm' | 'tool' | 'retrieval' | 'embedding' | 'custom'` (default `'custom'`).

### `observe(parent, options, fn)`

Wraps an async function in a span. Auto-ends the span on success or failure (rethrows the error).

```ts
const result = await observe(traceOrSpan, { name: 'work' }, async (span) => {
  // span is open here
  return doWork()
  // span automatically closes; .end() is idempotent so you can still
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
`callbacks` option of any LangChain chain, LLM, or `RunnableConfig`. No
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
  onStepFinish: tracker.onStepFinish,  // optional (captures multi-step tool calls)
  onFinish: tracker.onFinish,          // required (records final usage)
  onError: tracker.onError,            // recommended (ends the span if a streaming call fails)
})
```

Attach to an existing trace:

```ts
const trace = client.startTrace({ name: 'ai_pipeline' })
const tracker = createSpanlensTracker({ client, trace, modelName: 'gpt-4o' })

await generateText({ ..., onFinish: tracker.onFinish })
await trace.end()
```

### Ollama (local LLMs)

`observeOllama()` traces calls against a local Ollama instance. Use the OpenAI client pointed at Ollama's OpenAI-compatible endpoint. The wrapper tags the span as `provider: 'ollama'` so the dashboard charts it separately:

```ts
import OpenAI from 'openai'
import { SpanlensClient, observeOllama } from '@spanlens/sdk'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const ollama = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',   // ignored by Ollama; required by the openai SDK
})

const trace = client.startTrace({ name: 'local_summarize' })
const res = await observeOllama(trace, 'llama3_summary', () =>
  ollama.chat.completions.create({
    model: 'llama3.1',
    messages: [{ role: 'user', content: 'Summarize: ...' }],
  }),
)
await trace.end()
```

### LlamaIndex TS (v0.3.0+)

`@spanlens/sdk/llamaindex` hooks directly into LlamaIndex's
`Settings.callbackManager`, so every LLM call is automatically traced:

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

## Graceful shutdown with `client.flush()`

Background ingest writes are fire-and-forget. In short-lived processes (scripts, one-shot jobs, serverless cold starts) the process may exit before all POSTs complete. Call `flush()` before exit to drain them:

```ts
const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })

// ... your agent logic ...

await client.flush()   // resolves when all in-flight ingest calls have settled
process.exit(0)
```

`flush()` resolves even if some requests failed. It uses `Promise.allSettled` internally so a network error won't hang the process.

## Troubleshooting and error handling

Instrumentation is fire-and-forget by design, so **observability never crashes your app**. Every ingest call is governed by two `SpanlensConfig` options:

| Option | Type | Default | Description |
|---|---|---|---|
| `silent` | `boolean` | `true` | When `true`, ingest failures are swallowed (the call resolves to `null`) so your hot path is never interrupted. When `false`, the failure is **re-thrown** so you can surface it in tests or fail-fast environments. |
| `onError` | `(err, context) => void` | (none) | Called on **every** dropped or failed delivery, regardless of `silent`. `context` is the failing route, e.g. `"POST /ingest/traces"`. Use it to forward errors to your monitoring stack. |

Even with the default `silent: true`, `onError` still fires, so you get full visibility without the risk of an unhandled rejection taking down a request.

```ts
const client = new SpanlensClient({
  apiKey: process.env.SPANLENS_API_KEY!,
  onError: (err, context) => {
    // err is a SpanlensTransportError for HTTP failures (status, code, endpoint)
    // and the raw underlying error for network or timeout failures.
    myLogger.warn('spanlens delivery dropped', { context, err })
  },
})
```

### Common failures and what to do

For the misconfigurations customers hit most, the SDK also prints a single actionable `console.warn` prefixed with `[spanlens]` (deduped, one warning per failure kind), so a silently dropping integration is visible in your logs:

| Symptom | Cause | Fix |
|---|---|---|
| `401 UNAUTHORIZED` | Key not accepted | Check the three usual suspects: (1) the `SPANLENS_API_KEY` env var is actually loaded in the running process, (2) the key was not revoked in the dashboard, (3) no whitespace or quotes were pasted around the key. See the [quick start](https://www.spanlens.io/docs/quick-start). |
| `403 PUBLIC_KEY_WRITE_FORBIDDEN` | A public key (`sl_live_pub_*`) was used for ingest or proxy | Public keys are read-only. Create a full `sl_live_` key on the Projects & Keys page for tracing. |
| `429 RATE_LIMIT` | Monthly quota or rate limit hit | Review usage and upgrade at [spanlens.io/pricing](https://www.spanlens.io/pricing) or manage your plan on the billing page. |

The SDK also warns once at `SpanlensClient` construction when the configured `apiKey` does not start with `sl_live_` (probably not a Spanlens key) or starts with `sl_live_pub_` (read-only, ingest will be rejected). The key itself is never printed.

### Tuning `timeoutMs`

Each ingest call has a `timeoutMs` deadline (default `3000` ms) covering the whole request, headers and body. The default is deliberately short: observability should not hold up user code. Raise it if you run in a region far from the ingest endpoint or behind a slow egress proxy; lower it (e.g. `1000`) in latency-critical paths where you would rather drop a span than wait. Timed-out calls are retried automatically (see below), then reported to `onError`.

### Flush before process exit

Ingest is fire-and-forget, so short-lived processes (scripts, CI jobs, serverless handlers) can exit before deliveries settle. Call `await client.flush()` before exit; see [Graceful shutdown with `client.flush()`](#graceful-shutdown-with-clientflush) above.

### `SpanlensApiError` and `SpanlensTransportError`

When the Spanlens server rejects a call with its standard error envelope (a `4xx`), the SDK surfaces a typed `SpanlensApiError` instead of a bare `Error`. This lets you branch on a stable `code` rather than string-matching a message. It reaches you either through `onError` (always) or as a thrown value (when `silent: false`).

```ts
import { SpanlensApiError, SpanlensTransportError } from '@spanlens/sdk'

class SpanlensTransportError extends Error {
  code: string                              // stable machine code, or 'HTTP_<status>' when no envelope
  status: number                            // HTTP status
  endpoint: string                          // failing route, e.g. 'POST /ingest/traces'
}

class SpanlensApiError extends SpanlensTransportError {
  details?: Record<string, unknown>         // optional structured context
  requestId: string | null                  // server request id for support
}
```

`SpanlensTransportError` is the base class for every classified HTTP failure, including responses that do not carry the standard envelope (a CDN error page, for example). `instanceof SpanlensApiError` checks keep working unchanged.

### Automatic retries

The transport retries **transient** failures on its own, so a brief network blip doesn't lose a span:

- **Retried** (up to `3` attempts total) with exponential back-off `200 ms → 400 ms → 800 ms`: network errors, request timeouts (default `3000 ms`), and `5xx`.
- **Not retried**: `4xx` client errors, including `429`. These indicate a configuration or quota problem (bad key, missing scope, malformed body, exhausted plan), so retrying wastes time. They go straight to `onError` (and throw when `silent: false`).

Because every trace and span carries a **client-generated UUID**, retries are idempotent: the same UUID delivered twice is a no-op on the server.

### Forwarding to Sentry

```ts
import * as Sentry from '@sentry/node'
import { SpanlensClient, SpanlensApiError } from '@spanlens/sdk'

const client = new SpanlensClient({
  apiKey: process.env.SPANLENS_API_KEY!,
  // Keep silent:true so a Spanlens outage never breaks your app,
  // but still capture the failure for later.
  onError: (err, context) => {
    if (err instanceof SpanlensApiError) {
      Sentry.captureException(err, {
        tags: { spanlens_code: err.code, spanlens_context: context },
        extra: { requestId: err.requestId, status: err.status },
      })
    } else {
      Sentry.captureException(err, { tags: { spanlens_context: context } })
    }
  },
})
```

Set `silent: false` only in test suites or CI, where you *want* a broken ingest call to fail loudly.

## Sampling

High-volume agents can generate a lot of trace ingest traffic. `sampleRate` lets you record a representative fraction of traces while keeping cost and volume under control.

```ts
const client = new SpanlensClient({
  apiKey: process.env.SPANLENS_API_KEY!,
  sampleRate: 0.1,   // ingest ~10% of traces
})
```

- **`sampleRate`** is a number in `[0.0, 1.0]`. Default `1.0` (record everything). A malformed value (out of range, `NaN`, or a string) throws at `SpanlensClient` construction rather than silently dropping traces.
- **Per-trace and sticky**: the keep/drop decision is made **once**, at `client.startTrace()`, and applies to every span under that trace. Sampling whole traces (never individual spans) keeps each surviving trace a fully coherent tree in the dashboard.
- **Proxy logs are unaffected**: `sampleRate` only controls the agent-tracing layer (`/ingest/traces`, `/ingest/spans`). Your `/proxy/*` LLM request logs (cost, tokens, quota, anomalies) are **always** recorded at 100%.

### Tail-based error capture

Error traces are the traces you most want to keep. So even when a trace loses the sampling coin-flip, the SDK **buffers** its spans in memory instead of sending them, then:

- if the trace ends with `status: 'error'`, the buffered spans are replayed to the server, so the trace is recorded in full;
- otherwise the buffer is discarded.

The result: at `sampleRate: 0.1` you still capture **100% of error traces** plus a 10% sample of successful ones. (Errors are detected either from an explicit `status: 'error'` or from passing `errorMessage` to `trace.end()`.)

### Recommended: sample in prod, keep everything in staging

```ts
const client = new SpanlensClient({
  apiKey: process.env.SPANLENS_API_KEY!,
  sampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
})
```

Staging traffic is low, so record everything for debugging. Production is high-volume, so sample the happy path (`0.1`) while tail-based capture guarantees every error still lands.

## Design notes

- **Fire-and-forget ingest**: `startTrace()` and `trace.span()` return synchronously. Network writes run in the background so your hot path never waits on observability.
- **Retry with back-off**: transient failures (network error, 429, 5xx) are retried up to 3 times with exponential back-off (200 ms → 400 ms → 800 ms). 4xx errors are not retried.
- **Client-side UUIDs**: idempotent retries are safe, since the same UUID twice is a no-op on the server.
- **No unhandled rejections**: background POST failures are silently swallowed; use the `onError` hook for visibility.

## SDK versions & feature parity

> **On version numbers.** The TypeScript (`@spanlens/sdk`) and Python (`spanlens`) SDKs are versioned **completely independently**. A version number in one says nothing about the other, and the gap between them is not a signal of maturity or maintenance. Both are pre-1.0 and both are actively maintained; features land in each on its own release cadence.

The table below is the honest, file-level comparison of what each package ships today. Use it to check whether a capability you rely on exists in the SDK for your language before you build on it.

| Capability | TypeScript (`@spanlens/sdk`) | Python (`spanlens`) |
| --- | :---: | :---: |
| Core tracing (client / trace / span / `observe`) | ✓ | ✓ |
| Sampling (head-based, configurable rate) | ✓ | ✓ |
| OpenAI auto-instrument helper | ✓ `observeOpenAI` | ✓ `observe_openai` |
| Anthropic auto-instrument helper | ✓ `observeAnthropic` | ✓ `observe_anthropic` |
| Gemini auto-instrument helper | ✓ `observeGemini` | ✓ `observe_gemini` |
| Ollama auto-instrument helper (local LLMs) | ✓ `observeOllama` | ✓ `observe_ollama` |
| Proxy client factory (OpenAI) | ✓ `createOpenAI` | ✓ `create_openai` |
| Proxy client factory (Anthropic) | ✓ `createAnthropic` | ✓ `create_anthropic` |
| Proxy client factory (Gemini) | ✓ `createGemini` | ✓ `create_gemini` |
| Proxy client factory (Ollama) | ✓ `createOllama` (`@spanlens/sdk/ollama`) | ✗ (use a raw OpenAI client at `localhost:11434`) |
| LangChain integration | ✓ | ✓ |
| LangGraph integration | ✓ (via the LangChain handler) | ✓ (via the LangChain handler) |
| LlamaIndex integration | ✓ | ✓ |
| Vercel AI SDK integration | ✓ | ✗ (Vercel AI is JS-only) |
| Evals API (script-driven prompt CI) | ✓ `EvalsApi` | ✗ (not yet) |
| CLI (`init` wizard) | ✓ (separate [`@spanlens/cli`](https://www.npmjs.com/package/@spanlens/cli) package) | ✓ (bundled `spanlens` command) |

`partial` is not used above because every current capability is either fully present or absent in a given SDK. If you need a capability marked ✗ in your language, open an issue. Parity gaps are tracked and prioritized.

## License

MIT
