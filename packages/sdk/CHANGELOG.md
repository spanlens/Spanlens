# @spanlens/sdk changelog

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
