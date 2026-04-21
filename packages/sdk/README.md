# @spanlens/sdk

LLM observability SDK for [Spanlens](https://spanlens.io). Record agent traces, LLM calls, tool invocations, and retrievals — with a single line change.

**Zero-instrumentation mode** — just swap your `baseURL` to Spanlens proxy and you get request logging + cost tracking automatically. Use this SDK when you also want **agent tracing** (multi-step workflows, parallel fan-out, nested spans).

## Install

```bash
npm install @spanlens/sdk
# or
pnpm add @spanlens/sdk
```

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

## Design notes

- **Fire-and-forget ingest**: `startTrace()` and `trace.span()` return synchronously. Network writes run in the background so your hot path never waits on observability.
- **Client-side UUIDs**: idempotent retries are safe — same UUID twice is a no-op on the server.
- **No unhandled rejections**: background POST failures are silently swallowed; use the `onError` hook for visibility.
- **No auto-instrumentation yet**: OpenAI/Anthropic wrappers ship in v0.2 — for now, wrap LLM calls manually inside `observe()` (or wrap via the proxy baseURL + manual span for tracing metadata).

## License

MIT
