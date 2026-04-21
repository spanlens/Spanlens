# @spanlens/sdk changelog

## 0.1.0

Initial release.

### Added
- `SpanlensClient({ apiKey, baseUrl?, timeoutMs?, silent?, onError? })` — main entry point
- `TraceHandle` — `.span()`, `.end()`, idempotent
- `SpanHandle` — `.child()` for nesting, `.end()` with usage + cost + requestId, `.traceHeaders()` for proxy correlation
- `observe(parent, options, fn)` — generic span wrapper with auto-close on error
- `observeOpenAI(parent, name, fn)` — auto-parse OpenAI `usage` into span tokens
- `observeAnthropic(parent, name, fn)` — `input_tokens` / `output_tokens` variant
- `observeGemini(parent, name, fn)` — `usageMetadata` variant
- `parseOpenAIUsage` / `parseAnthropicUsage` / `parseGeminiUsage` — structural usage parsers exported for manual use
- Types: `SpanlensConfig`, `TraceOptions`, `SpanOptions`, `EndTraceOptions`, `EndSpanOptions`, `SpanType`, `Status`

### Design notes
- Fire-and-forget network: `startTrace()` and `trace.span()` return synchronously; ingest POSTs run in the background.
- Unhandled rejections silenced on background calls (use `onError` hook for visibility).
- `silent: false` rethrows only from awaited calls (`span.end()`, `trace.end()`).
- Client-generated UUIDs — idempotent retries are safe (same UUID twice is a server-side no-op).
- Edge-compatible — uses `fetch` + `crypto.randomUUID()` only.
