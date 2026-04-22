# @spanlens/sdk changelog

## 0.2.1

Metadata-only release — expanded npm keywords for discoverability. No functional changes.

## 0.2.0

Zero-config provider clients — 1-line setup for the common case.

### Added
- `@spanlens/sdk/openai` — `createOpenAI(options?)` returns an `OpenAI` client pre-configured with the Spanlens proxy baseURL. Reads `SPANLENS_API_KEY` from env by default. All OpenAI options (timeout, organization, defaultHeaders, etc.) forward through.
- `@spanlens/sdk/anthropic` — `createAnthropic(options?)` — same pattern.
- `@spanlens/sdk/gemini` — `createGemini(options?)` returns a Proxy-wrapped `GoogleGenerativeAI`. Every `getGenerativeModel()` call auto-injects the Spanlens baseUrl (Gemini SDK doesn't support baseUrl in the constructor).
- Peer dependencies: `openai >=4`, `@anthropic-ai/sdk >=0.24`, `@google/generative-ai >=0.20` — all marked **optional** so users only need the provider(s) they actually use.

### Why this matters
Before v0.2.0, integrating Spanlens into an app required remembering the proxy URL (`https://spanlens-server.vercel.app/proxy/openai/v1`) and setting `apiKey` + `baseURL` manually. The new helpers reduce the boilerplate to a single function call and eliminate typos in the URL.

### Backward compatible
All existing exports (`SpanlensClient`, `observe*`, `parse*`) unchanged.

## 0.1.1

Patch release — verifies the CI publish pipeline end-to-end with the granular npm token now that `@spanlens/sdk` exists on the registry. No functional changes.

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
