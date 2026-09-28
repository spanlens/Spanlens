# @spanlens/sdk changelog

## Unreleased

Tracing no longer sits on your request path, `flush()` drains everything, span bodies follow `logBody`, and self-hosted deployments are picked up from `SPANLENS_BASE_URL`.

### Changed

- `observe()` and every `observe<Provider>()` helper return as soon as your callback settles. The span's end PATCH is queued in the background instead of being awaited, so a slow or unreachable Spanlens server no longer adds its round trips (up to about 29 seconds with the defaults) to your response time. Pass `awaitIngest: true` to wait for delivery inline.
- `span.end()` and `trace.end()` stamp `ended_at` at the moment they are called. Previously it was taken after the creation POST finished, so ingest latency inflated span durations on the dashboard.
- `observeOllama()` now defaults to `logBody: 'meta'`: the span carries tokens, model, status, and timing but not the prompt or response, matching the promise that a local model's bodies stay on your machine. Pass `logBody: 'full'` to capture the response as span output again.
- `@spanlens/sdk/gemini` header helpers (`withUser`, `withSession`, `withLogBody`, `withCache`, `withPromptVersion`) now return `{ customHeaders, headers }`. `@google/generative-ai` only sends `customHeaders`, so the previous `{ headers }` shape never reached the proxy. Merge several helpers through `customHeaders`.

### Added

- `SPANLENS_BASE_URL`: when set to a self-hosted server origin (for example `https://spanlens.example.com`, as written by `spanlens init --server-url`), every proxy factory routes to that origin plus the hosted route's path, and the client's ingest and evals calls use it too. An explicit `baseURL` / `baseUrl` option still wins; `createOllama()` is unaffected.
- `client.flush({ timeoutMs })` caps how long flush waits.
- `tracker.end(result)` on the Vercel AI tracker closes the span from an awaited `generateText` / `generateObject` result. Those functions have no `onFinish` callback in AI SDK 4.x and 5.x, so the previously documented `generateText({ onFinish })` never closed the span.
- The Vercel AI tracker records a structured `object` (from `generateObject` / `streamObject`) as JSON text output.
- `ObserveOptions` and `FlushOptions` types are exported.

### Fixed

- `client.flush()` now waits for span and trace ends that were never awaited, including ones still queued behind their creation POST, and keeps draining until nothing new is pending. Before, it returned while those PATCHes were outstanding, so fire-and-forget ends (and the LlamaIndex integration, which always ends spans that way) could leave spans `running` after a serverless freeze or `process.exit`.
- With `logBody: 'meta'` or `'none'`, the provider helpers no longer send the response as span output or the prompt as span input. Previously the option only set the proxy header, and the full response still went to ingest through the span.
- LangChain: every top-level run gets its own trace. A handler shared across overlapping invocations (as the docs recommend) used to merge them into one trace, drop the second run's error status, and leave later runs in a trace that never ended. Sampled-out error runs are still recorded when a parallel run succeeds.
- LangChain: `maxInputBytes` / `maxOutputBytes` count UTF-8 bytes. They compared UTF-16 string length, so CJK text was stored at up to 3x the cap and emoji at 2x; the preview is now cut on a character boundary and `originalBytes` is a real byte count.
- Vercel AI: token totals cover the whole run. From AI SDK 5.0 on, `onFinish` passes the last step's `usage` and the run's sum in `totalUsage`; the tracker now prefers `totalUsage`, then the sum of the steps seen by `onStepFinish`, then `usage`.
- Gemini: `getGenerativeModelFromCachedContent()` routes through the Spanlens proxy. It used to call Google directly with your Spanlens key. An OpenAI-style `{ headers }` passed to either model factory is folded into `customHeaders`.
- `evals.run({ timeoutMs })` is a hard deadline. It now aborts a stalled trigger POST, poll request, or response body and never sleeps past the deadline, instead of waiting for the runtime's own fetch timeout (about 5 minutes on Node) and failing with "fetch failed".
- The retry description in the docs and code comments now matches the transport: 3 attempts in total (the first try plus 2 retries) with 200 ms and 400 ms back-off. The documented 800 ms step never happened.

## 0.17.0

Mistral and OpenRouter integrations, plus header-helper parity across every proxy subpath.

### Added

- `@spanlens/sdk/mistral` and `@spanlens/sdk/openrouter` subpaths. Both providers are OpenAI-compatible, so `createMistral(options?)` and `createOpenRouter(options?)` return an OpenAI client already pointed at the matching hosted Spanlens proxy route (`/proxy/mistral/v1`, `/proxy/openrouter/v1`). `DEFAULT_SPANLENS_MISTRAL_PROXY` and `DEFAULT_SPANLENS_OPENROUTER_PROXY` are exported for self-hosted overrides.
- `observeMistral` and `observeOpenRouter` tracers, exported from the package root and from their subpaths. Both parse the standard OpenAI `usage` shape and tag the span with the right provider.
- The X-Spanlens-* header helpers, `withUser`, `withSession`, `withLogBody`, `withCache`, and `withPromptVersion` (plus `cacheHeaderValue` and the header-name constants), are now exported from every proxy integration subpath: `gemini`, `groq`, `deepseek`, `xai`, `cohere`, `ollama`, `mistral`, and `openrouter`. Previously they were only available from `@spanlens/sdk/openai` and `@spanlens/sdk/anthropic`, which forced a second import to tag, for example, a Groq request with a user ID.

### Changed

- The header helpers now live in one shared internal module and are re-exported by each integration, so behavior is guaranteed identical across subpaths. No public API changes: existing imports from `@spanlens/sdk/openai` and `@spanlens/sdk/anthropic` keep working unchanged.

## 0.16.0

Default API host moved to the official `api.spanlens.io` domain.

### Changed

- All default base URLs now point at `https://api.spanlens.io` instead of `https://spanlens-server.vercel.app`: the transport (`baseUrl`), `runEvals`, and every provider proxy default (`openai`, `anthropic`, `gemini`, `groq`, `deepseek`, `xai`, `cohere`). Both hosts serve the same deployment, so previously released SDK versions keep working unchanged. Explicit `baseUrl` / `baseURL` overrides are unaffected.

## 0.15.1

Reliability fixes for observe(), the transport, and the framework trackers. No API changes beyond a new optional onError handler on the Vercel AI tracker.

### Fixed

- `observe()` no longer misclassifies arrays, `Map`, or `Set` as streams. Stream detection previously keyed on `Symbol.iterator`, which those containers have, so their return value was silently dropped instead of captured as span output. Only async-iterables and `ReadableStream`-likes are treated as streams now.
- `observe()` error path no longer masks the caller's original error. A failure inside the automatic `span.end()` is swallowed so the user's thrown error always propagates unchanged.
- Transport: a user `onError` callback that throws can no longer crash the host process.
- Transport: the response body read is now bounded by a timeout, so a server that accepts the request but stalls the body no longer hangs `flush()` or process exit.
- Transport: payload serialization failures (for example, circular references in `metadata`) are non-retryable. They fail fast with a clear `onError` message instead of exhausting the retry budget and then dropping the span silently.
- Vercel AI and LlamaIndex integrations: when the instrumented call throws, the span and trace are ended with `status: 'error'` instead of leaking a perpetual `running` trace. LlamaIndex also clears its internal runs map.

### Added

- `createSpanlensTracker()` (Vercel AI) now returns an `onError` handler. Wire it into `streamText` / `streamObject` as `onError: tracker.onError` so a streaming failure ends the span, since `onFinish` never fires on error.

## 0.15.0

Four more OpenAI-compatible providers: Groq, DeepSeek, xAI (Grok), and Cohere.

### Added

- `@spanlens/sdk/groq`, `@spanlens/sdk/deepseek`, `@spanlens/sdk/xai`, and `@spanlens/sdk/cohere` subpaths, each exporting a `createX(options?)` factory that returns an OpenAI-compatible client already pointed at the matching hosted Spanlens proxy route, plus its `observeX` tracer. `DEFAULT_SPANLENS_<PROVIDER>_PROXY` is exported for self-hosted overrides.
- `observeGroq`, `observeDeepSeek`, `observeXai`, and `observeCohere` are also exported from the package root. All four parse the standard OpenAI `usage` shape and tag the span with the right provider.

Register the provider key on your Spanlens project, set `SPANLENS_API_KEY`, and the client works like a normal OpenAI client. Streamed Groq / DeepSeek / xAI calls capture usage automatically; Cohere's compatibility layer does not accept the usage-on-stream flag, so streamed Cohere calls may log cost as null (non-streaming Cohere is costed normally).

## 0.14.0

Dedicated Ollama subpath — a one-line client factory for local models.

### Added

- `@spanlens/sdk/ollama` subpath exporting `createOllama(options?)`, which returns an OpenAI-compatible client already pointed at the local Ollama endpoint (`http://localhost:11434/v1`), and re-exports `observeOllama` so a single import gives you both the client and the tracer. `DEFAULT_OLLAMA_BASE_URL` is exported for self-hosted overrides.

### Fixed

- The README Ollama example used the wrong `observeOllama` signature (missing the trace argument and the `headers` callback), so copy-pasting it did not compile or trace. It now shows the correct `observeOllama(trace, name, (headers) => ...)` usage built on `createOllama()`.

## 0.13.0

Judge result caching (P3-18) — re-evaluations of the same sample with the same evaluator return $0.

### Added

- `EvalRun.cache_hits` — number of judge calls served from `judge_cache` instead of hitting the LLM. CI jobs can log "X cached, Y new" and reason about cost. 0 / absent on pre-migration rows.

The cache is keyed by `(organization, evaluator_config_hash, response+expected_hash)`. Editing an evaluator (criterion, model, rubric, anchors) rotates the hash so old cache entries are naturally invalidated — no manual invalidation API needed. A daily TTL cron prunes rows older than 30 days.

## 0.12.0

P3 score-model polish — raw judge scores + server-computed distributions.

### Added

- `EvalResult.value_raw_number` (P3-15) — the judge's raw answer before clamp/normalisation. The dashboard can render "4 out of 5" instead of only the derived 0.8. `null` for non-numeric typed configs and pre-migration rows.
- `EvalRun.distribution` (P3-16) — a precomputed summary for typed configs whose `avg_score` is null. Discriminated union with `type: 'categorical' | 'boolean' | 'text'`. Lets clients render a histogram in one shot instead of pulling every per-sample row. `null`/absent for NUMERIC / legacy / embedding runs.
- `RunDistribution` type export.

## 0.11.1

P3 read-side polish — pagination on list endpoints, more accurate cost estimate.

### Added

- `listRuns({ page, limit })` and `getResults(id, { page, limit })` accept optional pagination params (1-based, max limit 100). The server now paginates instead of capping at 50 rows; the SDK keeps returning a plain `EvalRun[]` / `EvalResult[]` for back-compat.

## 0.11.0

Agent trajectory evaluation (P2-11) — score the whole trace, not just the final text.

### Added

- `RunEvalInput.promptVersionId` is now optional. A trajectory evaluator scores recent traces by name, so a run needs only `evaluatorId` (+ optional `sampleSize` / `sampleFrom`). Example: `client.evals.run({ evaluatorId, sampleSize: 50 })`.
- `EvalRun.trace_name` — for trajectory runs, the trace name that was scored. `EvalRun.prompt_version_id` is `null` for these runs.

## 0.10.0

Pairwise (A vs B) eval runs (P1-7) — compare two prompt versions head-to-head.

### Added

- `RunEvalInput.mode: 'single' | 'pairwise'` and `RunEvalInput.promptVersionBId`. With `mode: 'pairwise'`, the run generates a response from both `promptVersionId` (A) and `promptVersionBId` (B) for each dataset item and asks the judge which wins. Requires `source: 'dataset'` + `runProvider`/`runModel`.
- `EvalRun.mode`, `EvalRun.prompt_version_b_id`, and the `a_wins` / `b_wins` / `ties` tally. The completed run's `avg_score` is B's win-rate (1 = B wins, 0 = A wins, 0.5 = tie), so `scoreConfidenceInterval(run)` gives a CI on the win-rate.
- `EvalResult.winner: 'a' | 'b' | 'tie'` per comparison.

## 0.9.0

Confidence intervals on eval scores (P1-7) — tell a real regression from sampling noise in CI.

### Added

- `EvalRun.score_stddev` — the sample standard deviation of the scores behind `avg_score`. `null` when the run has fewer than 2 numeric samples or the evaluator has no mean (CATEGORICAL / TEXT).
- `scoreConfidenceInterval(run)` — computes the 95% confidence interval (`mean ± 1.96·stddev/√n`) for a run's mean score, returning `{ mean, margin, low, high }` (or `null`). Gate on `ci.high < threshold` to fail a build only when even the optimistic bound is below your bar, instead of reacting to noise.
- `ScoreInterval` type export.

## 0.6.1

Metadata + docs polish. No runtime API changes (already-shipped 0.6 features remain identical: `observeOllama`, LangGraph callback handler, `withLogBody`, etc.).

### Added

- `sideEffects: false` in `package.json`. Bundlers (Webpack, Vite, Next.js, Rspack) can now tree-shake unused subpath imports, so users who import only `@spanlens/sdk/openai` no longer pull in the LangChain, Vercel AI, LlamaIndex, or Llamaindex modules.
- `engines.node` set to `>=18.0.0`. Install on Node 16 now warns instead of failing at runtime when the SDK calls native `fetch`.
- `ollama` keyword for npm search discoverability (`observeOllama` shipped in 0.6.0 but the keyword list was not updated then).

### Fixed

- `clean` script is now cross-platform. Local Windows publish flow (`pnpm run clean && pnpm run build`) used to abort because `rm -rf dist` is not a Windows command. Replaced with a Node-based `fs.rmSync`.

### Docs

- README documents `withUser` / `withSession` / `withLogBody` alongside the existing `withPromptVersion` section (all four header helpers were already exported in 0.4+).
- New `observeOllama` section showing the OpenAI-compatible client pattern.
- Removed a stale "no auto-instrumentation yet" design note that contradicted the `createOpenAI` / `createAnthropic` / `createGemini` one-liners documented elsewhere on the page.

## 0.3.0

Framework callback integrations — trace LangChain, Vercel AI SDK, and LlamaIndex without touching the proxy URL.

### Added

- **`@spanlens/sdk/langchain`** — `createSpanlensCallbackHandler({ client, trace?, traceName? })`.
  Returns a LangChain-compatible callback handler (duck-typed, no `@langchain/core` import). Pass to the `callbacks` option of any chain, LLM, or `RunnableConfig`. Captures `promptTokens`, `completionTokens`, `model_name` from `llmOutput`, handles concurrent runs by `runId`, and records error spans on `handleLLMError`.

- **`@spanlens/sdk/vercel-ai`** — `createSpanlensTracker({ client, trace?, traceName?, modelName? })`.
  Returns `{ onStepFinish, onFinish }` that spread directly into `generateText`, `streamText`, `generateObject`, and `streamObject` options. Auto-computes `totalTokens` when absent, records `finishReason` and multi-step count in span metadata.

- **`@spanlens/sdk/llamaindex`** — `registerSpanlensCallbacks(Settings, { client, trace?, traceName? })`.
  Hooks into `Settings.callbackManager` `llm-start` / `llm-end` events. Parses `raw.usage.input_tokens` / `output_tokens` from the LlamaIndex response. Returns an `unregister()` cleanup function.

All three integrations:
- Accept an optional `trace?: TraceHandle` — when provided, spans are attached to it and `trace.end()` is left to the caller. When omitted, a trace is auto-created and closed per LLM call.
- Are fully duck-typed (no imports from the framework package) — compatible with any version.
- Follow the SDK's fire-and-forget, silent-by-default contract.

### Backward compatible

All existing exports unchanged. The three new entry points are additive.

## 0.2.3

Critical fix — long-running traces lost their spans on serverless runtimes.

### Fixed
- **Race condition** between trace POST and span POST. Previously both fired in parallel; on the server, span ingestion verifies trace ownership by SELECT, which would 404 if the trace INSERT hadn't committed yet. The span end PATCH then matched zero rows (silent failure), so the dashboard showed `0 spans, 0 tokens` for the entire trace. Short routes (<3s) usually got lucky; long-running routes (LLM streaming, agent workflows) systematically lost spans.
- `createTrace` and `createSpan` now expose an internal `_creationPromise`. Child spans chain their POST after the parent's, and `end()` (both span and trace) waits for its own creation POST before sending PATCH. User code is unaffected — chaining happens during the LLM call wait.

### Why you should upgrade
If you saw traces in the Spanlens dashboard with `Spans: 0` despite calling `observe()` or `trace.span()`, this fix resolves it. No API changes.

## 0.2.2

Prompt-version request tagging — completes the round-trip for the Prompts feature.

### Added
- `withPromptVersion(id)` on `@spanlens/sdk/openai` and `@spanlens/sdk/anthropic`. Returns a `{ headers }` object that the OpenAI/Anthropic SDKs accept as the second argument to any call. Tags the logged request with the specified prompt version so it links into the A/B comparison on `/prompts`.
- `promptVersion` option on `observeOpenAI`, `observeAnthropic`, `observeGemini`. Same effect; convenient when you're already using `observe*` for agent tracing.
- Accepted id formats: `"<name>@<version>"` (e.g. `"chatbot-system@3"`), `"<name>@latest"` (auto-resolves server-side), or a raw `prompt_versions.id` UUID.
- `PROMPT_VERSION_HEADER` constant exported from both integration modules for callers who want to set the header directly.

### Backend requirement
Needs `spanlens-server` ≥ commit landing this feature. Older servers ignore the header silently (request still works, just isn't linked to a version).

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
